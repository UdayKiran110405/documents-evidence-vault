package com.evidencevault.backend.service;

import com.evidencevault.backend.dto.AuthResponse;
import com.evidencevault.backend.dto.LoginRequest;
import com.evidencevault.backend.dto.RegisterRequest;
import com.evidencevault.backend.entity.Role;
import com.evidencevault.backend.entity.RoleName;
import com.evidencevault.backend.entity.User;
import com.evidencevault.backend.exception.ResourceConflictException;
import com.evidencevault.backend.repository.RoleRepository;
import com.evidencevault.backend.repository.UserRepository;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;

    public AuthService(
            UserRepository userRepository,
            RoleRepository roleRepository,
            PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager,
            JwtService jwtService) {

        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.jwtService = jwtService;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {

        if (userRepository.existsByUsername(request.username())) {
            throw new ResourceConflictException(
                    "Username is already registered"
            );
        }

        if (userRepository.existsByEmail(request.email())) {
            throw new ResourceConflictException(
                    "Email is already registered"
            );
        }

        Role operatorRole = roleRepository
                .findByName(RoleName.ROLE_OPERATOR)
                .orElseThrow(() -> new IllegalStateException(
                        "ROLE_OPERATOR is missing from the database"
                ));

        User user = new User();

        user.setUsername(request.username());
        user.setEmail(request.email());
        user.setPassword(
                passwordEncoder.encode(request.password())
        );
        user.setEnabled(true);

        user.setRoles(
                new LinkedHashSet<>(List.of(operatorRole))
        );

        User savedUser = userRepository.save(user);

        String token = jwtService.generateToken(savedUser);

        return new AuthResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                savedUser.getUsername(),
                List.of(RoleName.ROLE_OPERATOR.name())
        );
    }

    public AuthResponse login(LoginRequest request) {

        Authentication authentication =
                authenticationManager.authenticate(
                        new UsernamePasswordAuthenticationToken(
                                request.username(),
                                request.password()
                        )
                );

        String authenticatedUsername =
                authentication.getName();

        User user = userRepository
                .findByUsername(authenticatedUsername)
                .orElseThrow(() -> new IllegalStateException(
                        "Authenticated user was not found"
                ));

        String token = jwtService.generateToken(user);

        List<String> roles = user.getRoles()
                .stream()
                .map(role -> role.getName().name())
                .toList();

        return new AuthResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getUsername(),
                roles
        );
    }
}