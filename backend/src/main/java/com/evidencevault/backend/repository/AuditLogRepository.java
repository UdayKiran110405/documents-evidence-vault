package com.evidencevault.backend.repository;

import com.evidencevault.backend.entity.AuditLog;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AuditLogRepository
        extends JpaRepository<AuditLog, Long> {

    List<AuditLog> findByDocumentIdOrderByCreatedAtDesc(
            Long documentId
    );

    List<AuditLog> findAllByOrderByCreatedAtDesc();

    List<AuditLog> findByUsernameOrderByCreatedAtDesc(
            String username
    );
}