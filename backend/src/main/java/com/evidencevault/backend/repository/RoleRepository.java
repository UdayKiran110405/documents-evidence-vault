package com.evidencevault.backend.repository;

import com.evidencevault.backend.entity.Role;
import com.evidencevault.backend.entity.RoleName;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RoleRepository extends JpaRepository<Role, Long> {

    Optional<Role> findByName(RoleName name);
}