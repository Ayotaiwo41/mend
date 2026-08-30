package com.mend;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import java.util.Map;


@RestController
@RequestMapping("/api/tmdb")
public class TmdbProxyController {

    @Value("${TMDB_TOKEN:}")
    private String tmdbToken;

    private static final String TMDB_BASE = "https://api.themoviedb.org/3";
    private final RestTemplate restTemplate = new RestTemplate();


    @GetMapping("/**")
    public ResponseEntity<String> proxy(
            HttpServletRequest request,
            @RequestParam(required = false) Map<String, String> params
    ) {

        String tmdbPath = request.getRequestURI().replace("/api/tmdb", "");


        UriComponentsBuilder builder = UriComponentsBuilder
                .fromHttpUrl(TMDB_BASE + tmdbPath);
        if (params != null) {
            params.forEach(builder::queryParam);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + tmdbToken);
        headers.set("Content-Type", "application/json");

        ResponseEntity<String> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class
        );

        return ResponseEntity
                .status(response.getStatusCode())
                .contentType(MediaType.APPLICATION_JSON)
                .body(response.getBody());
    }
}
