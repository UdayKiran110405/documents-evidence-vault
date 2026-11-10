package com.evidencevault.backend.service;

import com.evidencevault.backend.entity.AuditLog;
import com.evidencevault.backend.repository.AuditLogRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class AuditService {

    private final AuditLogRepository auditLogRepository;

    public AuditService(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            String username,
            String action,
            Long documentId,
            String details) {

        auditLogRepository.save(
                new AuditLog(username, action, documentId, details)
        );
    }

    @Transactional(readOnly = true)
    public List<AuditLog> getDocumentHistory(Long documentId) {
        return auditLogRepository
                .findByDocumentIdOrderByCreatedAtDesc(documentId);
    }
}