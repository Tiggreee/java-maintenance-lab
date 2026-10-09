package lat.vmdev.maintlab.incident.service;

import java.time.Instant;
import java.util.List;
import lat.vmdev.maintlab.incident.model.IncidentStatus;
import lat.vmdev.maintlab.incident.model.IncidentTicket;
import lat.vmdev.maintlab.incident.repo.IncidentRepository;
import lat.vmdev.maintlab.incident.web.dto.IncidentCreateRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class IncidentService {

    private static final Logger log = LoggerFactory.getLogger(IncidentService.class);

    private final IncidentRepository incidentRepository;
    private final int defaultSlaMinutes;

    public IncidentService(
            IncidentRepository incidentRepository,
            @Value("${incidents.default-sla-minutes:45}") int defaultSlaMinutes) {
        this.incidentRepository = incidentRepository;
        this.defaultSlaMinutes = defaultSlaMinutes;
    }

    @Transactional
    public IncidentTicket create(IncidentCreateRequest request) {
        IncidentTicket incident = new IncidentTicket();
        incident.setTitle(request.getTitle());
        incident.setServiceName(request.getServiceName());
        incident.setSeverity(request.getSeverity());
        incident.setSlaMinutes(
                request.getSlaMinutes() != null ? request.getSlaMinutes() : defaultSlaMinutes);
        incident.setOwner(request.getOwner());
        IncidentTicket saved = incidentRepository.save(incident);
        log.info("Incident {} opened for {} (severity={}, slaMinutes={})",
                saved.getId(), saved.getServiceName(), saved.getSeverity(), saved.getSlaMinutes());
        return saved;
    }

    @Transactional(readOnly = true)
    public IncidentTicket get(Long id) {
        return incidentRepository.findById(id).orElseThrow(() -> notFound(id));
    }

    @Transactional(readOnly = true)
    public List<IncidentTicket> list() {
        return incidentRepository.findAllByOrderByOpenedAtDesc();
    }

    @Transactional
    public IncidentTicket changeStatus(Long id, IncidentStatus status) {
        IncidentTicket incident = incidentRepository.findById(id).orElseThrow(() -> notFound(id));
        IncidentStatus current = incident.getStatus();
        // Statuses are declared in lifecycle order (OPEN, ACKNOWLEDGED, RESOLVED): never go back.
        if (status.ordinal() < current.ordinal()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Incident " + id + " cannot move from " + current + " back to " + status);
        }
        if (status == IncidentStatus.ACKNOWLEDGED && incident.getAcknowledgedAt() == null) {
            incident.setAcknowledgedAt(Instant.now());
        }
        if (status == IncidentStatus.RESOLVED && incident.getResolvedAt() == null) {
            incident.setResolvedAt(Instant.now());
        }
        incident.setStatus(status);
        IncidentTicket saved = incidentRepository.save(incident);
        if (status != current) {
            log.info("Incident {} moved from {} to {}", id, current, status);
        }
        return saved;
    }

    private ResponseStatusException notFound(Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Incident not found: " + id);
    }
}
