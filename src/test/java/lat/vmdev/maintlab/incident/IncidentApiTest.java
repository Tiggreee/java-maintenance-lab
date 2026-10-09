package lat.vmdev.maintlab.incident;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import lat.vmdev.maintlab.incident.model.IncidentSeverity;
import lat.vmdev.maintlab.incident.model.IncidentStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class IncidentApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void createsAndAcknowledgesIncident() throws Exception {
        long id = createIncident(payload("Payments unavailable", 30));

        patchStatus(id, IncidentStatus.ACKNOWLEDGED)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value(IncidentStatus.ACKNOWLEDGED.name()))
            .andExpect(jsonPath("$.acknowledgedAt").isNotEmpty());
    }

    @Test
    void createdIncidentIsOpenWithRequestedSla() throws Exception {
        mockMvc.perform(post("/api/incidents")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(payload("Payments unavailable", 30))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value(IncidentStatus.OPEN.name()))
            .andExpect(jsonPath("$.slaMinutes").value(30));
    }

    @Test
    void usesConfiguredDefaultSlaWhenOmitted() throws Exception {
        mockMvc.perform(post("/api/incidents")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(payload("Login slow", null))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.slaMinutes").value(45));
    }

    @Test
    void rejectsInvalidRequests() throws Exception {
        Map<String, Object> blankTitle = payload(" ", 30);
        Map<String, Object> slaTooSmall = payload("Valid title", 1);
        Map<String, Object> slaTooLarge = payload("Valid title", 5000);
        Map<String, Object> noSeverity = payload("Valid title", 30);
        noSeverity.remove("severity");

        for (Map<String, Object> invalid : new Map[] {blankTitle, slaTooSmall, slaTooLarge, noSeverity}) {
            mockMvc.perform(post("/api/incidents")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(invalid)))
                .andExpect(status().isBadRequest());
        }
    }

    @Test
    void recordsResolutionTimestamp() throws Exception {
        long id = createIncident(payload("Disk full", 60));

        patchStatus(id, IncidentStatus.RESOLVED)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value(IncidentStatus.RESOLVED.name()))
            .andExpect(jsonPath("$.resolvedAt").isNotEmpty());
    }

    @Test
    void refusesToMoveAnIncidentBackwards() throws Exception {
        long id = createIncident(payload("Queue stuck", 60));
        patchStatus(id, IncidentStatus.RESOLVED).andExpect(status().isOk());

        patchStatus(id, IncidentStatus.OPEN).andExpect(status().isConflict());
        patchStatus(id, IncidentStatus.ACKNOWLEDGED).andExpect(status().isConflict());
        // Repeating the current status stays harmless.
        patchStatus(id, IncidentStatus.RESOLVED).andExpect(status().isOk());
    }

    @Test
    void returnsNotFoundForUnknownIncident() throws Exception {
        mockMvc.perform(get("/api/incidents/999999")).andExpect(status().isNotFound());
        patchStatus(999999L, IncidentStatus.ACKNOWLEDGED).andExpect(status().isNotFound());
    }

    @Test
    void listsNewestIncidentFirst() throws Exception {
        createIncident(payload("Older incident", 30));
        Thread.sleep(5);
        long newest = createIncident(payload("Newest incident", 30));

        mockMvc.perform(get("/api/incidents"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(newest));
    }

    private org.springframework.test.web.servlet.ResultActions patchStatus(
            long id, IncidentStatus newStatus) throws Exception {
        return mockMvc.perform(patch("/api/incidents/" + id + "/status")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("status", newStatus.name()))));
    }

    private long createIncident(Map<String, Object> payload) throws Exception {
        String body = mockMvc.perform(post("/api/incidents")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(payload)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
        return ((Number) objectMapper.readValue(body, Map.class).get("id")).longValue();
    }

    private Map<String, Object> payload(String title, Integer slaMinutes) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("title", title);
        payload.put("serviceName", "payments-api");
        payload.put("severity", IncidentSeverity.HIGH.name());
        payload.put("owner", "ops");
        if (slaMinutes != null) {
            payload.put("slaMinutes", slaMinutes);
        }
        return payload;
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }
}
