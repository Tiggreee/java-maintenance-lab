package lat.vmdev.maintlab.incident.repo;

import java.util.Collection;
import java.util.List;
import lat.vmdev.maintlab.incident.model.IncidentStatus;
import lat.vmdev.maintlab.incident.model.IncidentTicket;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IncidentRepository extends JpaRepository<IncidentTicket, Long> {

    List<IncidentTicket> findByStatusInOrderByOpenedAtAsc(Collection<IncidentStatus> statuses);

    List<IncidentTicket> findAllByOrderByOpenedAtDesc();
}
