package com.evidencevault.backend.controller;

import com.evidencevault.backend.entity.AuditLog;
import com.evidencevault.backend.service.AuditService;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/audit")
public class AuditController {

    private final AuditService auditService;

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public List<AuditLog> getAllAuditLogs() {
        return auditService.getAllLogs();
    }

    @GetMapping("/documents/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public List<AuditLog> getDocumentHistory(
            @PathVariable Long documentId) {

        return auditService.getDocumentHistory(documentId);
    }
}