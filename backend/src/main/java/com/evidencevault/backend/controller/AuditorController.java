package com.evidencevault.backend.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auditor")
public class AuditorController {

    @GetMapping("/status")
    public Map<String, String> getAuditorStatus() {

        return Map.of(
                "access", "GRANTED",
                "role", "ROLE_AUDITOR",
                "message", "Auditor access verified"
        );
    }
}