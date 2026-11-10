package com.evidencevault.backend.config;

import com.evidencevault.backend.entity.Role;
import com.evidencevault.backend.entity.RoleName;
import com.evidencevault.backend.entity.User;
import com.evidencevault.backend.repository.RoleRepository;
import com.evidencevault.backend.repository.UserRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.LinkedHashSet;
import java.util.Set;

@Configuration
public class AdminBootstrapInitializer {

    @Value("${app.bootstrap-admin.username:}")
    private String username;

    @Value("${app.bootstrap-admin.email:}")
    private String email;

    @Value("${app.bootstrap-admin.password:}")
    private String password;

    @Bean
    CommandLineRunner initializeAdmin(
            UserRepository userRepository,
            RoleRepository roleRepository,
            PasswordEncoder passwordEncoder) {

        return args -> {

            if (username.isBlank()
                    || email.isBlank()
                    || password.isBlank()) {

                System.out.println(
                        "Admin bootstrap skipped: credentials not configured"
                );

                return;
            }

            if (password.length() < 12) {
                throw new IllegalStateException(
                        "Bootstrap admin password must be at least 12 characters"
                );
            }

            if (userRepository.existsByUsername(username)) {
                System.out.println(
                        "Admin bootstrap skipped: username already exists"
                );

                return;
            }

            if (userRepository.existsByEmail(email)) {
                throw new IllegalStateException(
                        "Bootstrap admin email already belongs to another account"
                );
            }

            Role adminRole = roleRepository
                    .findByName(RoleName.ROLE_ADMIN)
                    .orElseGet(() -> roleRepository.save(
                            new Role(RoleName.ROLE_ADMIN)
                    ));

            User admin = new User();

            admin.setUsername(username);
            admin.setEmail(email);
            admin.setPassword(passwordEncoder.encode(password));
            admin.setEnabled(true);
            admin.setRoles(
                    new LinkedHashSet<>(Set.of(adminRole))
            );

            userRepository.save(admin);

            System.out.println(
                    "Initial administrator account created successfully"
            );
        };
    }
}