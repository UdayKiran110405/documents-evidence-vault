package com.evidencevault.backend.controller;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

import com.evidencevault.backend.exception.PythonVerifierException;
import com.evidencevault.backend.service.PythonVerifierClient;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1/dr")
public class PythonVerifierController {

    private final PythonVerifierClient verifierClient;
    private final String verifierBaseUrl;
    private final String serviceToken;

    public PythonVerifierController(
            PythonVerifierClient verifierClient,
            @Value("${app.python-verifier.base-url}") String verifierBaseUrl,
            @Value("${app.python-verifier.service-token}") String serviceToken) {
        this.verifierClient = verifierClient;
        this.verifierBaseUrl = verifierBaseUrl;
        this.serviceToken = serviceToken;
    }

    @GetMapping("/regions/status")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')")
    public JsonNode getRegionsStatus() {
        return verifierClient.getRegionsStatus();
    }

    @PostMapping("/verify/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')")
    public JsonNode verifyDocument(@PathVariable Long documentId) {
        return verifierClient.verifyDocument(documentId);
    }

    @PostMapping("/recover/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public JsonNode recoverDocument(
            @PathVariable Long documentId,
            @RequestParam(required = false) String versionId) {
        return verifierClient.recoverDocument(documentId, versionId);
    }

    @PostMapping("/drills/run/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public JsonNode runDrill(@PathVariable Long documentId) {
        return verifierClient.runDrill(documentId);
    }

    @PostMapping("/drills/simulate-primary-failure/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public JsonNode simulatePrimaryFailure(@PathVariable Long documentId) {
        return verifierClient.simulatePrimaryFailure(documentId);
    }

    @PostMapping("/drills/simulate-corruption/{documentId}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public JsonNode simulateCorruption(@PathVariable Long documentId) {
        return verifierClient.simulateCorruption(documentId);
    }

    @GetMapping(value = "/drills/stream/{documentId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<StreamingResponseBody> streamDrill(
            @PathVariable Long documentId,
            @RequestParam(defaultValue = "outage") String mode) {

        StreamingResponseBody stream = outputStream -> {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(5))
                    .build();

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(verifierBaseUrl + "/api/v1/drills/stream/" + documentId + "?mode=" + mode))
                    .header("X-Service-Token", serviceToken)
                    .GET()
                    .build();

            try {
                HttpResponse<InputStream> response =
                        client.send(request, HttpResponse.BodyHandlers.ofInputStream());
                try (InputStream body = response.body()) {
                    byte[] buffer = new byte[1024];
                    int bytesRead;
                    while ((bytesRead = body.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                        outputStream.flush();
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };

        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(stream);
    }

    @GetMapping("/drills")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public JsonNode getDrillHistory() {
        return verifierClient.getDrillHistory();
    }

    @GetMapping("/manifests")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public JsonNode getRecoveryManifests() {
        return verifierClient.getRecoveryManifests();
    }

    @GetMapping("/metrics")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public JsonNode getMetrics() {
        return verifierClient.getMetrics();
    }

    @PostMapping("/snowflake-sync")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_AUDITOR')")
    public JsonNode syncSnowflake() {
        return verifierClient.syncSnowflake();
    }

    @ExceptionHandler(PythonVerifierException.class)
    public ResponseEntity<Object> handlePythonError(
            PythonVerifierException exception) {
        return ResponseEntity
                .status(exception.getStatus())
                .body(Map.of("detail", exception.getMessage()));
    }
}