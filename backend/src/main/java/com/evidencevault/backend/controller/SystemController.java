package com.evidencevault.backend.controller;

import com.evidencevault.backend.repository.RoleRepository;
import com.evidencevault.backend.repository.UserRepository;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;

    public SystemController(
            UserRepository userRepository,
            RoleRepository roleRepository) {

        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {

        long userCount = userRepository.count();
        long roleCount = roleRepository.count();

        Map<String, Object> response = new LinkedHashMap<>();

        response.put("application", "UP");
        response.put("database", "UP");
        response.put("totalUsers", userCount);
        response.put("totalRoles", roleCount);
        response.put("message", "JPA and MySQL are connected");

        return ResponseEntity.ok(response);
    }
}