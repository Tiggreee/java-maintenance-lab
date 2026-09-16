package lat.vmdev.maintlab.incident;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import lat.vmdev.maintlab.incident.model.IncidentSeverity;
import lat.vmdev.maintlab.incident.model.IncidentStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class IncidentApiIT {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void createsAndAcknowledgesIncident() throws Exception {
        String request = objectMapper.writeValueAsString(Map.of(
            "title", "Payments unavailable",
            "serviceName", "payments-api",
            "severity", IncidentSeverity.HIGH.name(),
            "slaMinutes", 30,
                "owner", "ops"));

        String createdBody = mockMvc.perform(post("/api/incidents")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value(IncidentStatus.OPEN.name()))
            .andExpect(jsonPath("$.slaMinutes").value(30))
            .andReturn()
            .getResponse()
            .getContentAsString();

        Number id = (Number) objectMapper.readValue(createdBody, Map.class).get("id");

        mockMvc.perform(patch("/api/incidents/" + id + "/status")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("status", IncidentStatus.ACKNOWLEDGED.name()))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value(IncidentStatus.ACKNOWLEDGED.name()))
            .andExpect(jsonPath("$.acknowledgedAt").isNotEmpty());
    }
}