package lat.vmdev.maintlab.incident.api;

import java.util.List;
import javax.validation.Valid;
import lat.vmdev.maintlab.incident.model.IncidentTicket;
import lat.vmdev.maintlab.incident.service.IncidentService;
import lat.vmdev.maintlab.incident.web.dto.IncidentCreateRequest;
import lat.vmdev.maintlab.incident.web.dto.IncidentStatusRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/incidents")
public class IncidentController {

    private final IncidentService incidentService;

    public IncidentController(IncidentService incidentService) {
        this.incidentService = incidentService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public IncidentTicket create(@Valid @RequestBody IncidentCreateRequest request) {
        return incidentService.create(request);
    }

    @GetMapping
    public List<IncidentTicket> list() {
        return incidentService.list();
    }

    @GetMapping("/{id}")
    public IncidentTicket get(@PathVariable Long id) {
        return incidentService.get(id);
    }

    @PatchMapping("/{id}/status")
    public IncidentTicket changeStatus(
            @PathVariable Long id,
            @Valid @RequestBody IncidentStatusRequest request) {
        return incidentService.changeStatus(id, request.getStatus());
    }
}