
package com.evidencevault.backend.repository;

import com.evidencevault.backend.entity.DocumentVersion;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DocumentVersionRepository
        extends JpaRepository<DocumentVersion, Long> {

    Optional<DocumentVersion> findByDocumentIdAndS3VersionId(
            Long documentId,
            String s3VersionId
    );

    List<DocumentVersion> findByDocumentIdOrderByCreatedAtDesc(
            Long documentId
    );


    List<DocumentVersion> findByDocumentIdOrderByIdDesc(Long documentId);


}
