package com.evidencevault.backend.repository;

import com.evidencevault.backend.entity.Document;
import com.evidencevault.backend.entity.DocumentCategory;
import com.evidencevault.backend.entity.DocumentStatus;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DocumentRepository
        extends JpaRepository<Document, Long> {

    @Query("""
        SELECT d FROM Document d
        WHERE (:keyword IS NULL OR
               LOWER(d.originalFilename) LIKE LOWER(CONCAT('%', :keyword, '%')))
        AND (:category IS NULL OR d.category = :category)
        AND (:status IS NULL OR d.status = :status)
        """)
    Page<Document> searchDocuments(
            @Param("keyword") String keyword,
            @Param("category") DocumentCategory category,
            @Param("status") DocumentStatus status,
            Pageable pageable
    );

    boolean existsBySha256ChecksumAndStatus(
            String sha256Checksum,
            DocumentStatus status
    );
}