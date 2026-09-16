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

Creating an incident defaults its status to `OPEN` and its SLA to 45 minutes
when no SLA is provided. Status transitions record acknowledgment and
resolution timestamps.

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

The full test suite includes the Spring context test and an integration test
covering incident creation and acknowledgment through the web layer.

## Endpoints for operations

- `GET /maintlab/actuator/health`
- `GET /maintlab/actuator/info`
- `GET /maintlab/actuator/metrics`
