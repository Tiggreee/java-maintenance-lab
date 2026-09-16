package lat.vmdev.maintlab.incident.service;

import java.time.Instant;
import java.util.List;
import javax.transaction.Transactional;
import lat.vmdev.maintlab.incident.model.IncidentStatus;
import lat.vmdev.maintlab.incident.model.IncidentTicket;
import lat.vmdev.maintlab.incident.repo.IncidentRepository;
import lat.vmdev.maintlab.incident.web.dto.IncidentCreateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class IncidentService {

    private final IncidentRepository incidentRepository;

    public IncidentService(IncidentRepository incidentRepository) {
        this.incidentRepository = incidentRepository;
    }

    @Transactional
    public IncidentTicket create(IncidentCreateRequest request) {
        IncidentTicket incident = new IncidentTicket();
        incident.setTitle(request.getTitle());
        incident.setServiceName(request.getServiceName());
        incident.setSeverity(request.getSeverity());
        incident.setSlaMinutes(request.getSlaMinutes());
        incident.setOwner(request.getOwner());
        return incidentRepository.save(incident);
    }

    @Transactional
    public IncidentTicket get(Long id) {
        return incidentRepository.findById(id).orElseThrow(() -> notFound(id));
    }

    @Transactional
    public List<IncidentTicket> list() {
        return incidentRepository.findAllByOrderByOpenedAtDesc();
    }

    @Transactional
    public IncidentTicket changeStatus(Long id, IncidentStatus status) {
        IncidentTicket incident = get(id);
        if (status == IncidentStatus.ACKNOWLEDGED && incident.getAcknowledgedAt() == null) {
            incident.setAcknowledgedAt(Instant.now());
        }
        if (status == IncidentStatus.RESOLVED && incident.getResolvedAt() == null) {
            incident.setResolvedAt(Instant.now());
        }
        incident.setStatus(status);
        return incidentRepository.save(incident);
    }

    private ResponseStatusException notFound(Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Incident not found: " + id);
    }
}