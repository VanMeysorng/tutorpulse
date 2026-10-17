# TutorPulse: AI-Assisted STEM Practice and Classroom Gap Analytics (Microservices Backend)

TutorPulse lets teachers turn lesson notes into practice sets, lets students practise with up to three clues per question, and streams every attempt to an analytics service that shows teachers which concepts the class is struggling with.

The backend has 7 Node.js microservices behind an API Gateway that checks JWTs and enforces role-based access control (RBAC). Each service has its own MongoDB database. It runs in Docker on 4 EC2 instances, with an Nginx load balancer in front of two gateway replicas. `web/` is an optional demo UI and is not part of the graded backend.

**Roles:** `admin`, `teacher`, `student`.
**Source:** https://github.com/VanMeysorng/tutorpulse

## 1. Architecture

```
                       Postman / client
                             | HTTP :80
                  +----------v-----------+  EC2-1
                  |  Nginx load balancer |  round robin + failover
                  +-----+----------+-----+
                        |          |
           gateway-1 :3000      gateway-2 :3007 (host port)   EC2-1 / EC2-2
           verifies JWT, deny-by-default RBAC table,
           adds x-user-* headers + secret x-internal-key
                        |
   +-----------+--------+---+-----------+------------+-------------+
   |           |            |           |            |             |
registration  login      classes     content     practice     analytics
  :3001       :3002       :3003       :3004        :3005         :3006
  EC2-2       EC2-2       EC2-3       EC2-3        EC2-4         EC2-4
 tp_auth    tp_login   tp_classes  tp_content  tp_practice  tp_analytics
                                    MongoDB 7 :27017 (EC2-4)
```

| # | Microservice | Port | EC2 | Database | Base URL (through the load balancer) |
|---|---|---|---|---|---|
| 1 | api-gateway (x2) | 3000 (gateway-2 on host 3007) | EC2-1, EC2-2 | none | `http://<EC2-1-IP>/api` |
| 2 | registration-service | 3001 | EC2-2 | tp_auth | `/api/auth/register`, `/api/users/me`, `/api/admin/users` |
| 3 | login-service | 3002 | EC2-2 | tp_login | `/api/auth/login`, `/api/auth/me`, `/api/auth/history` |
| 4 | class-service | 3003 | EC2-3 | tp_classes | `/api/classes` |
| 5 | content-service | 3004 | EC2-3 | tp_content | `/api/content` |
| 6 | practice-service | 3005 | EC2-4 | tp_practice | `/api/practice` |
| 7 | analytics-service | 3006 | EC2-4 | tp_analytics | `/api/analytics` |
| - | Nginx load balancer | 80 | EC2-1 | - | `http://<EC2-1-IP>` |
| - | MongoDB 7 | 27017 | EC2-4 | 6 databases | private only |

Services 1–3 are the common services. Member 1 builds class-service and content-service; Member 2 builds practice-service and analytics-service. That gives 3 + 2 + 2 = 7 microservices.

**Request flow:** Nginx sends `/api/*` to one of the two gateways. The gateway strips any identity headers sent by the client and matches the method and path against a deny-by-default rule table. It then verifies the JWT (HS256, issuer, expiry), checks the role, and forwards the request with `x-user-id`, `x-user-role` and a secret `x-internal-key`. Every service answers 403 when that key is missing, so a service cannot be called directly. Each service also checks the role again itself.

## 2. APIs per microservice (all through `http://<EC2-1-IP>`)

Postman numbers (for example `4.9`) refer to `scripts/TutorPulse.postman_collection.json`.

### registration-service :3001 (tp_auth.users)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /api/auth/register | public | Sign up as teacher or student (admin cannot self-register) |
| GET | /api/users/me | any | Read my profile |
| PUT | /api/users/me | any | Update my name and/or password (needs current password) |
| POST | /api/admin/users | admin | Create a user with any role |
| GET | /api/admin/users?role=&search=&page=&limit= | admin | List / filter / search users |
| GET | /api/admin/users/:id | admin | Read one user |
| PUT | /api/admin/users/:id | admin | Update name, email, role |
| PATCH | /api/admin/users/:id/role | admin | Change role only |
| DELETE | /api/admin/users/:id | admin | Delete user + cascade (classes, attempts, events, login records) |

### login-service :3002 (tp_login.loginaudits)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /api/auth/login | public | Returns JWT; 5 failed logins in 15 min locks the email |
| GET | /api/auth/me | any | Identity from the token |
| GET | /api/auth/history | any | My last 20 logins |
| DELETE | /api/auth/history/:id | any | Delete one of my login records |
| DELETE | /api/auth/history | any | Clear my login history (failed attempts are kept for the lockout) |

### class-service :3003 (tp_classes.classes, tp_classes.feedbacks)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /api/classes | teacher | Create class (unique 6-character code) |
| GET | /api/classes | any | Teacher: own, student: joined (code hidden), admin: all |
| GET | /api/classes/:id | any (member/owner) | Read class |
| PUT | /api/classes/:id | teacher (owner) | Rename |
| DELETE | /api/classes/:id | teacher (owner) | Delete + cascade to content, practice, analytics |
| POST | /api/classes/join | student | Join with code |
| POST | /api/classes/:id/leave | student | Leave class |
| POST | /api/classes/:id/regenerate-code | teacher (owner) | New join code |
| GET | /api/classes/:id/students | teacher (owner) | Roster with names |
| DELETE | /api/classes/:id/students/:studentId | teacher (owner) | Remove a student |
| POST | /api/classes/:id/feedback | teacher (owner) | Feedback + meeting for a student in the class |
| GET | /api/classes/:id/feedback | any (member/owner) | List (students see only their own) |
| GET | /api/classes/:id/feedback/:fid | any (member/owner) | Read one |
| PUT | /api/classes/:id/feedback/:fid | teacher (owner) | Edit feedback / meeting |
| DELETE | /api/classes/:id/feedback/:fid | teacher (owner) | Delete feedback |
| POST | /api/classes/:id/feedback/:fid/respond | student | Acknowledge or ask to reschedule |

### content-service :3004 (tp_content.practicesets)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /api/content/classes/:classId/sets | teacher (owner) | Create set; AI (Groq) builds 10-15 questions from notes |
| GET | /api/content/classes/:classId/sets | teacher, student | List (students: published only, no answers) |
| GET | /api/content/sets/:id | teacher, student | Read one (answers and clues hidden from students) |
| PUT | /api/content/sets/:id | teacher (owner) | Update title, notes, cheat sheet, questions |
| POST | /api/content/sets/:id/publish | teacher (owner) | Publish / unpublish |
| POST | /api/content/sets/:id/regenerate | teacher (owner) | Re-run AI generation |
| DELETE | /api/content/sets/:id | teacher (owner) | Delete + cascade to practice and analytics |
| POST | /api/content/assistant | any | AI study assistant |
| POST | /api/content/feedback-template | teacher | AI-drafted feedback text |

### practice-service :3005 (tp_practice.attempts)
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | /api/practice/sets/:setId | student (member) | Open set with my progress |
| GET | /api/practice/sets/:setId/progress | student | Solved / attempts / clues per question |
| GET | /api/practice/sets/:setId/attempts | student | My attempt and clue log |
| POST | /api/practice/sets/:setId/questions/:qi/attempt | student | Submit answer (graded on the server) |
| POST | /api/practice/sets/:setId/questions/:qi/clue | student | Next clue (max 3, unique index) |
| DELETE | /api/practice/sets/:setId/questions/:qi/attempts | student | Reset one question |
| DELETE | /api/practice/sets/:setId/progress | student | Reset the whole set |

### analytics-service :3006 (tp_analytics.events, tp_analytics.interventions)
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | /api/analytics/classes/:classId/radar | teacher (owner), admin | Wrong-rate and clue use per question (Gap Radar) |
| GET | /api/analytics/classes/:classId/students | teacher, admin | Per-student summary |
| GET | /api/analytics/classes/:classId/concepts | teacher, admin | Weakest concepts first |
| GET | /api/analytics/classes/:classId/matrix | teacher, admin | Student x question heatmap |
| GET | /api/analytics/classes/:classId/export.csv | teacher, admin | CSV export |
| GET | /api/analytics/classes/:classId/ranking | any (member/owner) | Leaderboard |
| POST | /api/analytics/classes/:classId/interventions | teacher (owner) | Action plan for a weak concept (stores a radar snapshot) |
| GET | /api/analytics/classes/:classId/interventions?status=&priority= | teacher, admin | List |
| GET | /api/analytics/classes/:classId/interventions/:id | teacher, admin | Read one |
| PUT | /api/analytics/classes/:classId/interventions/:id | teacher (owner) | Update status / action / outcome |
| DELETE | /api/analytics/classes/:classId/interventions/:id | teacher (owner) | Delete |

Internal endpoints such as `/internal/...` (credential check, name lookup, telemetry, cascade cleanup) need the internal key and cannot be reached through the gateway.

## 3. CRUD coverage

| Collection (database) | Create | Read | Update | Delete |
|---|---|---|---|---|
| users (tp_auth) | register, admin create | me, list, search, one | me (name/password), admin PUT/PATCH | admin delete (cascade) |
| loginaudits (tp_login) | on every login | history | - (audit log) | one record, clear all |
| classes (tp_classes) | create, join | list, one, roster | rename, new code | delete (cascade), remove student, leave |
| feedbacks (tp_classes) | create | list, one | edit, student respond | delete |
| practicesets (tp_content) | create (+AI) | list, one | edit, publish, regenerate | delete (cascade) |
| attempts (tp_practice) | attempt, clue | progress, attempt log | - (immutable record) | reset question, reset set |
| events (tp_analytics) | telemetry stream | radar, students, concepts, matrix, ranking, CSV | - (immutable) | cascade on class/set/user delete |
| interventions (tp_analytics) | create | list, one | update | delete |

## 4. Schemas
Each schema is the `new mongoose.Schema({...})` block at the top of `services/<name>/index.js`.
`users {name, email (unique), passwordHash (bcrypt), role}` · `loginaudits {email, userId, success, ip}` · `classes {name, code (unique), teacherId, studentIds[]}` · `feedbacks {classId, teacherId, studentId, studentName, areaToImprove, feedbackText, meetingDate, meetingTime, meetingTopic, studentResponse, status}` · `practicesets {classId, teacherId, title, notes, cheat[], questions[{type, q, options, answer, concept, clues[3]}], published, source}` · `attempts {studentId, classId, setId, qIndex, type, correct, clueNo, answer}` · `events {classId, setId, studentId, qIndex, concept, type, correct}` · `interventions {classId, teacherId, concept, setId, action, priority, status, dueDate, outcome, snapshot}`. All collections have `createdAt`/`updatedAt` and indexes on their lookup fields.

## 5. Run locally
```bash
cp .env.example .env      # replace every change-me value (generator command is in the file)
COMPOSE_PROFILES=all docker compose up -d --build
npm run test:all          # smoke + CRUD tests and pipeline tests against http://localhost
```

## 6. Deploy on 4 EC2 instances (Ubuntu, t3.small or larger)
1. **Security groups.** EC2-1: 80 and 22 open to the internet. EC2-2/3/4: 22 from your IP only. Ports 3000-3007 and 27017 open only to the security group itself. Never expose 27017 publicly.
2. **On each instance:** install Docker (`curl -fsSL https://get.docker.com | sh`), `git clone`, `cp .env.ec2.example .env`. Fill in the four private IPs and real secrets, using the same `.env` on all four. Note that `GATEWAY_2` uses port **3007**.
3. **Start in this order:** EC2-4 `docker compose --profile data up -d --build`, EC2-3 `--profile learning`, EC2-2 `--profile core`, EC2-1 `--profile edge`.
4. In Postman, import `scripts/TutorPulse.postman_collection.json`. Set the `baseUrl` variable to `http://<EC2-1-PUBLIC-IP>` and set `adminEmail`/`adminPassword`, then run folders 0-9 in order.

> MongoDB only reads `MONGO_PASSWORD` the first time it creates its data volume. If you change the password later, run `docker compose --profile data down -v` on EC2-4 (this wipes the data).

## 7. Load balancer
`nginx/default.conf.template` defines `upstream gateways { gateway-1; gateway-2 }` (round robin, `max_fails`, `proxy_next_upstream`). Send `GET http://<EC2-1-IP>/health` several times: `X-Served-By` and `X-LB-Upstream` alternate between gateway-1 and gateway-2. To show failover, run `docker stop` on gateway-1, then request `/health` again: gateway-2 still answers. On `/api` calls, the `X-Gateway` response header names the gateway that handled the request.

## 8. Screenshot checklist (matches the submission document)
1. Each `mongoose.Schema` block, plus `docker exec -it <mongo> mongosh -u tpuser -p` → `show dbs`, then `use tp_auth` → `db.users.find()`, and the same for the other databases.
2. Every Postman request in folders 1–7 and 9, against the EC2 public IP.
3. `nginx/default.conf.template`, `docker-compose.yml`, and `/health` alternating between gateways (Postman 0.1).
4. Security tests (folder 8): wrong password 401, invalid token 401, one role's token on another role's route 403.
5. `docker ps` on each of the 4 instances.

## 9. Known limits
- Access tokens only, valid for 1 hour, with no refresh token or revocation list. A role change takes effect at the next login.
- MongoDB runs as a single node.
- Without `GROQ_API_KEY`, a simple offline generator builds fill-in-the-blank questions from the notes.
