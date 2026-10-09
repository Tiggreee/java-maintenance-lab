package lat.vmdev.maintlab;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class JavaMaintenanceLabApplication {

	public static void main(String[] args) {
		SpringApplication.run(JavaMaintenanceLabApplication.class, args);
	}

}
