
package com.evidencevault.backend.service;

import java.util.function.Supplier;

import com.evidencevault.backend.exception.PythonVerifierException;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import tools.jackson.databind.JsonNode;

@Service
public class PythonVerifierClient {

    private final RestClient restClient;

    public PythonVerifierClient(RestClient pythonVerifierRestClient) {
        this.restClient = pythonVerifierRestClient;
    }

    public JsonNode verifyDocument(Long documentId) {

        return execute(() ->
                restClient.post()
                        .uri("/api/v1/verify/{id}", documentId)
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode recoverDocument(
            Long documentId,
            String versionId) {

        return execute(() ->
                restClient.post()
                        .uri(uriBuilder -> {
                            var builder = uriBuilder
                                    .path("/api/v1/recover/{id}");

                            if (versionId != null && !versionId.isBlank()) {
                                builder.queryParam("version_id", versionId);
                            }

                            return builder.build(documentId);
                        })
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode runDrill(Long documentId) {

        return execute(() ->
                restClient.post()
                        .uri("/api/v1/drills/run/{id}", documentId)
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode simulatePrimaryFailure(Long documentId) {

        return execute(() ->
                restClient.post()
                        .uri(
                                "/api/v1/drills/simulate-primary-failure/{id}",
                                documentId
                        )
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode simulateCorruption(Long documentId) {

        return execute(() ->
                restClient.post()
                        .uri(
                                "/api/v1/drills/simulate-corruption/{id}",
                                documentId
                        )
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode getDrillHistory() {

        return execute(() ->
                restClient.get()
                        .uri("/api/v1/drills")
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode getRecoveryManifests() {

        return execute(() ->
                restClient.get()
                        .uri("/api/v1/manifests")
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode getMetrics() {

        return execute(() ->
                restClient.get()
                        .uri("/api/v1/metrics")
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode getRegionsStatus() {
        return execute(() ->
                restClient.get()
                        .uri("/api/v1/regions/status")
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    public JsonNode syncSnowflake() {
        return execute(() ->
                restClient.post()
                        .uri("/api/v1/etl/snowflake-sync")
                        .retrieve()
                        .body(JsonNode.class)
        );
    }

    private JsonNode execute(Supplier<JsonNode> operation) {

        try {
            return operation.get();

        } catch (RestClientResponseException exception) {

            int code = exception.getStatusCode().value();

            HttpStatusCode mappedStatus;
            String message;

            if (code == 400 || code == 404 || code == 422) {
                mappedStatus = exception.getStatusCode();

                message = switch (code) {
                    case 400 -> "Python verifier rejected the request";
                    case 404 -> "Requested document or resource was not found";
                    case 422 -> "Invalid request parameters";
                    default -> "Python verifier request failed";
                };

            } else {
                // An upstream 401/403 indicates an internal
                // service-authentication problem, not a user login failure.
                mappedStatus = HttpStatus.BAD_GATEWAY;
                message = "Python verifier returned an unexpected response";
            }

            throw new PythonVerifierException(
                    mappedStatus,
                    message
            );

        } catch (ResourceAccessException exception) {

            throw new PythonVerifierException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Python verification service is unavailable or timed out"
            );
        }
    }


}
