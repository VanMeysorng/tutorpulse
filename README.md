# TutorPulse: AI STEM Tutoring and Classroom Analytics (Backend)

Full-stack project: a web frontend (`web/`, served by Nginx) plus a microservices backend with API Gateway, JWT authentication, role-based authorization (admin, teacher, student), MongoDB, Docker, an Nginx load balancer and a 4-instance EC2 deployment.

Team layout (edit names): **Member 1** owns class-service and content-service. **Member 2** owns practice-service and analytics-service. Both share gateway, registration and login. Total = 3 common + 2 + 2 = **7 microservices**.

## 1. Architecture

```
Client / Postman
      |  :80
 [Nginx LB] --round robin--> [API Gateway 1]  [API Gateway 2]     (X-Served-By shows which)
                                   |  verifies JWT, enforces RBAC, adds x-user-* + x-internal-key
   +---------+---------+---------+----------+-----------+
   |         |         |         |          |           |
Registration Login   Classes   Content   Practice   Analytics
 :3001      :3002     :3003     :3004     :3005      :3006
 tp_auth   tp_login  tp_classes tp_content tp_practice tp_analytics   (one MongoDB, one database per service)
```

| # | Microservice | Port | Owner | EC2 | Database |
|---|---|---|---|---|---|
| 1 | api-gateway (x2 replicas) | 3000 | Shared | EC2-1, EC2-2 | none |
| 2 | registration-service | 3001 | Shared | EC2-2 | tp_auth |
| 3 | login-service | 3002 | Shared | EC2-2 | tp_login |
| 4 | class-service | 3003 | Member 1 | EC2-3 | tp_classes |
| 5 | content-service | 3004 | Member 1 | EC2-3 | tp_content |
| 6 | practice-service | 3005 | Member 2 | EC2-4 | tp_practice |
| 7 | analytics-service | 3006 | Member 2 | EC2-4 | tp_analytics |
| - | Nginx load balancer | 80 | Shared | EC2-1 | none |
| - | MongoDB 7 | 27017 | Shared | EC2-4 | all of the above |

**Frontend.** `web/` is a static single-page site (HTML, CSS, JS, no build step). Nginx on EC2-1 serves it and forwards `/api/*` to the gateways, so the browser only ever talks to one address. Screens: landing page, register and login (real JWT), teacher dashboard (classes, practice sets, set editor, class code, Gap Radar with heatmap and CSV export), student dashboard (join by code, practice with clues and progress), admin console (users, roles, all classes), login history.

**Request flow.** Client calls `/api/...`. The gateway rejects forged identity headers, checks the path against a deny-by-default RBAC table, verifies the JWT (HS256, issuer, expiry), compares the role, then forwards the request with `x-user-id`, `x-user-role` and a secret `x-internal-key`. Every downstream service returns 403 to anything without the internal key, so the services cannot be used directly. Each service re-checks the role (defense in depth). Services call each other over HTTP with the internal key (login to registration, content/practice/analytics to class-service, practice to content, practice to analytics for the telemetry stream).

## 2. Roles and access (enforced at the gateway and again in each service)

| Resource | admin | teacher | student |
|---|---|---|---|
| Register / login | public | public | public |
| `GET /api/auth/me`, `/history` | yes | yes | yes |
| `/api/admin/users*` | yes | no | no |
| Create / edit / delete class, regenerate code | no | own classes | no |
| `GET /api/classes*` | all | own | joined (no code shown) |
| `POST /api/classes/join` | no | no | yes |
| Content create / edit / publish / delete | no | own classes | no |
| `GET /api/content*` | no | own | published only, answers and clues hidden |
| `/api/practice*` | no | no | joined classes only |
| `/api/analytics*` | read | own classes only | no |

## 3. APIs (all through the gateway at `http://<LB-IP>/api`)

**registration-service :3001**: `POST /auth/register` (teacher or student), `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/role`, `DELETE /admin/users/:id`; internal `POST /internal/verify`, `POST /internal/lookup` (names for dashboards).
**login-service :3002**: `POST /auth/login` (returns JWT, 5 failures in 15 min locks the email), `GET /auth/me`, `GET /auth/history`.
**class-service :3003**: `POST /classes`, `GET /classes`, `GET /classes/:id`, `PUT /classes/:id`, `DELETE /classes/:id`, `POST /classes/join`, `POST /classes/:id/regenerate-code`, `GET /classes/:id/students`; internal `GET /internal/classes/:id`.
**content-service :3004**: `POST /content/classes/:classId/sets`, `GET /content/classes/:classId/sets`, `GET /content/sets/:id`, `PUT /content/sets/:id`, `POST /content/sets/:id/publish`, `POST /content/sets/:id/regenerate`, `DELETE /content/sets/:id`; internal `GET /internal/sets/:id`. Uses the Claude API for generation when `ANTHROPIC_API_KEY` is set.
**practice-service :3005**: `GET /practice/sets/:setId`, `GET /practice/sets/:setId/progress`, `POST /practice/sets/:setId/questions/:qi/attempt`, `POST /practice/sets/:setId/questions/:qi/clue` (max 3, enforced server-side by a unique index).
**analytics-service :3006**: `GET /analytics/classes/:classId/radar`, `/students`, `/concepts`, `/matrix`, `/export.csv`; internal `POST /internal/events`.

## 4. Collections and schemas
`users {name, email(unique), passwordHash(bcrypt), role}` | `loginaudits {email, userId, success, ip}` | `classes {name, code(unique), teacherId, studentIds[]}` | `practicesets {classId, teacherId, title, notes, cheat[], questions[{type, q, options, answer, concept, clues[3]}], published, source}` | `attempts {studentId, classId, setId, qIndex, type(attempt|clue), correct, clueNo}` | `events {classId, setId, studentId, qIndex, concept, type, correct}`. Schema code is in each `services/*/index.js` (screenshot the `new mongoose.Schema` blocks).

## 5. Run locally
```bash
cp .env.example .env            # then replace the secrets (command inside the file)
COMPOSE_PROFILES=all docker compose up -d --build
# open http://localhost in a browser (landing page, register, log in)
node tests/smoke.js http://localhost      # 55+ automated API checks
# first admin login: ADMIN_EMAIL / ADMIN_PASSWORD from .env
```

## 5b. See the UI first (no backend, no Docker)
Double-click `web/index.html`, or run `cd web && python3 -m http.server 8000` and open `http://localhost:8000/?demo`. `web/demo.js` fakes the API in memory so every screen works. Log in as `teacher@demo.com`, `student@demo.com` or `admin@demo.com` (any password). Class code `ABC234` joins the sample class. Data resets on refresh. On the real deployment `demo.js` stays inactive.

## 6. Deploy on 4 EC2 instances (Ubuntu 22.04, t3.small or larger)
1. Security groups. **EC2-1**: 80 and 22 open to the internet. **EC2-2/3/4**: 22 from your IP; ports 3000-3006 and 27017 open **only to the security group itself** (private traffic). Never expose 27017 publicly.
2. On each instance: install Docker (`curl -fsSL https://get.docker.com | sh`), clone the repo, `cp .env.ec2.example .env`, fill secrets and the four **private** IPs.
3. Start in this order: EC2-4 `docker compose --profile data up -d --build`, EC2-3 `--profile learning`, EC2-2 `--profile core`, EC2-1 `--profile edge`.
4. Open `http://<EC2-1-PUBLIC-IP>` in a browser for the website. Test the API: `node tests/smoke.js http://<EC2-1-PUBLIC-IP>` or import `scripts/TutorPulse.postman_collection.json` and set `baseUrl`.

## 7. Load balancer demonstration
Nginx (`nginx/default.conf.template`) serves the website and balances `/api` between the EC2-1 gateway and the EC2-2 gateway. Run `curl -i http://<EC2-1-IP>/health` several times: `X-Served-By` alternates between `gateway-1` and `gateway-2`. Then `docker stop` one gateway and repeat: all requests are still served (failover). Screenshot both.

## 8. Screenshot checklist (matches the submission document)
1. Each `mongoose.Schema` block. 2. Postman call per API on the EC2 public IP, plus MongoDB (`docker exec -it <mongo> mongosh -u tpuser`, `show dbs`, `db.users.find()`). 3. `nginx/default.conf.template` and the alternating `X-Served-By`. 4. Tests in folder "7 Security tests": wrong password (401), invalid token (401), student token on teacher route (403), teacher token on admin route (403), other teacher's analytics (403), student 4th clue (409). 5. `docker ps` on each instance.

## 9. Rubric mapping
Docker and distribution: one image per service, non-root user, health checks, restart policy, 7 services on 4 hosts. JWT/RBAC: gateway verification, deny-by-default route table, per-service role checks, internal key. Database/CRUD: full CRUD on users, classes and practice sets, one database per service. Load balancer: 2 gateway replicas behind Nginx with failover. Documentation: this file.

## 10. Known limits (be ready to explain)
Access tokens only (no refresh or revocation list). Tokens last 1 hour. MongoDB is a single node (add a replica set for production). Without `ANTHROPIC_API_KEY`, generated sets start empty and the teacher adds questions manually.
