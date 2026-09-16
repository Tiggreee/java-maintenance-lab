package lat.vmdev.maintlab.incident.web.dto;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import lat.vmdev.maintlab.incident.model.IncidentSeverity;

public class IncidentCreateRequest {

    @NotBlank
    @Size(max = 120)
    private String title;

    @NotBlank
    @Size(max = 80)
    private String serviceName;

    @NotNull
    private IncidentSeverity severity;

    @NotNull
    @Min(5)
    @Max(1440)
    private Integer slaMinutes;

    @Size(max = 60)
    private String owner;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getServiceName() {
        return serviceName;
    }

    public void setServiceName(String serviceName) {
        this.serviceName = serviceName;
    }

    public IncidentSeverity getSeverity() {
        return severity;
    }

    public void setSeverity(IncidentSeverity severity) {
        this.severity = severity;
    }

    public Integer getSlaMinutes() {
        return slaMinutes;
    }

    public void setSlaMinutes(Integer slaMinutes) {
        this.slaMinutes = slaMinutes;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }
}
