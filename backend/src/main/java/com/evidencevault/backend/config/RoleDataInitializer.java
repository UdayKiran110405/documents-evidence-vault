package com.evidencevault.backend.config;

import com.evidencevault.backend.entity.Role;
import com.evidencevault.backend.entity.RoleName;
import com.evidencevault.backend.repository.RoleRepository;

import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RoleDataInitializer {

    @Bean
    CommandLineRunner initializeRoles(RoleRepository roleRepository) {

        return args -> {

            for (RoleName roleName : RoleName.values()) {

                if (roleRepository.findByName(roleName).isEmpty()) {
                    roleRepository.save(new Role(roleName));
                    System.out.println("Created role: " + roleName);
                }
            }
        };
    }
}