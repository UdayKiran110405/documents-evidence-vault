package com.evidencevault.backend.exception;

public class DocumentIntegrityException extends RuntimeException {

    public DocumentIntegrityException(String message) {
        super(message);
    }
}