package com.evidencevault.backend.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    @GetMapping("/status")
    public Map<String, String> getAdminStatus() {

        return Map.of(
                "access", "GRANTED",
                "role", "ROLE_ADMIN",
                "message", "Administrator access verified"
        );
    }
}