# Java Maintenance Lab

Maintenance-oriented Spring Boot application for practicing incident handling,
SLA tracking and production support workflows.

## Stack

- Java 8 source and target compatibility
- Spring Boot 2.7.18
- Spring Web, Spring Data JPA and Bean Validation
- H2 for local development and tests
- Actuator health, info and metrics endpoints

## Incident API

The application runs under the `/maintlab` context path.

```text
POST  /maintlab/api/incidents
GET   /maintlab/api/incidents
GET   /maintlab/api/incidents/{id}
PATCH /maintlab/api/incidents/{id}/status
```

Creating an incident defaults its status to `OPEN` and its SLA to
`incidents.default-sla-minutes` (45) when no SLA is provided; an explicit SLA
must be between 5 and 1440 minutes. Status transitions record acknowledgment
and resolution timestamps. Statuses only move forward
(`OPEN` -> `ACKNOWLEDGED` -> `RESOLVED`); going back answers `409 Conflict`
and an unknown id answers `404`.

Example create request:

```json
{
  "title": "Payments unavailable",
  "serviceName": "payments-api",
  "severity": "HIGH",
  "slaMinutes": 30,
  "owner": "ops"
}
```

## Development

Use a JDK with Maven. The project targets Java 8 bytecode; the tests have been
validated with JDK 21.

```bash
export JAVA_HOME=/path/to/jdk
export PATH="$JAVA_HOME/bin:$PATH"
./mvnw test
./mvnw clean package
```

`./mvnw test` runs the Spring context test and the incident API tests
(creation, SLA defaults, validation, status transitions, not-found and
ordering) through the web layer. CI runs `./mvnw verify` on JDK 17 and 21.

## Endpoints for operations

- `GET /maintlab/actuator/health`
- `GET /maintlab/actuator/info`
- `GET /maintlab/actuator/metrics`
