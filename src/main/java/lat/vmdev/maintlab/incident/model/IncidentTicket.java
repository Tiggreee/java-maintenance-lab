package lat.vmdev.maintlab.incident.model;

import java.time.Instant;
import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Table;

@Entity
@Table(name = "incident_ticket")
public class IncidentTicket {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(nullable = false, length = 80)
    private String serviceName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private IncidentSeverity severity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private IncidentStatus status;

    @Column(nullable = false)
    private Instant openedAt;

    @Column
    private Instant acknowledgedAt;

    @Column
    private Instant resolvedAt;

    @Column(nullable = false)
    private Integer slaMinutes;

    @Column(length = 60)
    private String owner;

    @Column(length = 500)
    private String rcaSummary;

    @Column(nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (status == null) {
            status = IncidentStatus.OPEN;
        }
        if (openedAt == null) {
            openedAt = now;
        }
        if (slaMinutes == null || slaMinutes.intValue() < 1) {
            slaMinutes = Integer.valueOf(45);
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

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

    public IncidentStatus getStatus() {
        return status;
    }

    public void setStatus(IncidentStatus status) {
        this.status = status;
    }

    public Instant getOpenedAt() {
        return openedAt;
    }

    public void setOpenedAt(Instant openedAt) {
        this.openedAt = openedAt;
    }

    public Instant getAcknowledgedAt() {
        return acknowledgedAt;
    }

    public void setAcknowledgedAt(Instant acknowledgedAt) {
        this.acknowledgedAt = acknowledgedAt;
    }

    public Instant getResolvedAt() {
        return resolvedAt;
    }

    public void setResolvedAt(Instant resolvedAt) {
        this.resolvedAt = resolvedAt;
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

    public String getRcaSummary() {
        return rcaSummary;
    }

    public void setRcaSummary(String rcaSummary) {
        this.rcaSummary = rcaSummary;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
