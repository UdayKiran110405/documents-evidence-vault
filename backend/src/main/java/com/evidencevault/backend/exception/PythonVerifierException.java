
package com.evidencevault.backend.exception;

import org.springframework.http.HttpStatusCode;

public class PythonVerifierException extends RuntimeException {

    private final HttpStatusCode status;

    public PythonVerifierException(
            HttpStatusCode status,
            String message) {

        super(message);
        this.status = status;
    }

    public HttpStatusCode getStatus() {
        return status;
    }
}
