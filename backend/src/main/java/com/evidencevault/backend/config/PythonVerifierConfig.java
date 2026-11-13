package com.evidencevault.backend.config;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class PythonVerifierConfig {

    @Bean
    public RestClient pythonVerifierRestClient(
            @Value("${app.python-verifier.base-url}") String baseUrl,
            @Value("${app.python-verifier.service-token}") String serviceToken) {

        if (serviceToken == null || serviceToken.isBlank()) {
            throw new IllegalStateException(
                    "Python verifier service token is missing"
            );
        }

        SimpleClientHttpRequestFactory requestFactory =
                new SimpleClientHttpRequestFactory();

        requestFactory.setConnectTimeout(Duration.ofSeconds(5));
        requestFactory.setReadTimeout(Duration.ofSeconds(90));

        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(requestFactory)
                .defaultHeader("X-Service-Token", serviceToken)
                .build();
    }
}