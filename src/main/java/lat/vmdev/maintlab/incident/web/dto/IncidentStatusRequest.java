package lat.vmdev.maintlab.incident.web.dto;

import javax.validation.constraints.NotNull;
import lat.vmdev.maintlab.incident.model.IncidentStatus;

public class IncidentStatusRequest {

    @NotNull
    private IncidentStatus status;

    public IncidentStatus getStatus() {
        return status;
    }

    public void setStatus(IncidentStatus status) {
        this.status = status;
    }
}