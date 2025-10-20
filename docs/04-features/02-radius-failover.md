# RADIUS Failover & Health Checks

To ensure high availability, `radius-proxy` implements a robust RADIUS host management system that includes automatic failover and periodic health checks. This system guarantees that user authentications can continue even if the primary RADIUS server becomes unavailable.

This entire mechanism is managed by the `RadiusHostManager` class, located in `lib/radius_hosts.ts`.

## Core Concepts

### Host Pool

The foundation of the system is the **host pool**, an ordered list of RADIUS server IP addresses or hostnames defined in the `config.toml` file under the `RADIUS_HOSTS` key.

```toml
# The order defines the priority: 10.0.0.1 is tried first.
RADIUS_HOSTS = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
```

The order of hosts in this array is critical, as it defines the failover priority.

### Active Host

At any given time, the `RadiusHostManager` maintains a single **active host**. All incoming authentication requests are sent exclusively to this host. This prevents scattering requests across multiple servers and provides a predictable routing pattern.

The initial active host is determined at startup by probing each host in the configured order until a responsive one is found.

### Health State

For each host in the pool, the manager tracks its health state, which includes:
-   `lastOkAt`: The timestamp of the last successful communication.
-   `lastTriedAt`: The timestamp of the last attempted communication.
-   `consecutiveFailures`: The number of consecutive failed probes.

## Health Check Mechanism

To proactively monitor the status of all RADIUS servers, the manager runs a background health check cycle.

-   **Trigger**: The health check cycle is triggered by a `setInterval` loop.
-   **Interval**: The frequency of these checks is controlled by the `RADIUS_HEALTHCHECK_INTERVAL` parameter (default: 1800 seconds / 30 minutes).
-   **Probe**: A health check consists of sending a RADIUS `Access-Request` packet to a host using a dummy username and password (configured via `RADIUS_HEALTHCHECK_USER` and `RADIUS_HEALTHCHECK_PASSWORD`).
-   **Success Criteria**: A probe is considered successful if the host responds at all. This includes both `Access-Accept` and `Access-Reject` responses. The goal is to check for liveness (the server is running and reachable), not to validate the dummy credentials.
-   **Timeout**: Each probe has its own timeout, defined by `RADIUS_HEALTHCHECK_TIMEOUT` (default: 5 seconds). A timeout is considered a failure.

## Automatic Failover

Failover is the process of automatically switching the active host when the current one is determined to be down. This can be triggered in two ways:

1.  **Reactive Failover (During User Authentication)**
    -   A user attempts to log in, and the proxy sends an `Access-Request` to the current active host.
    -   The request times out (as defined by `RADIUS_TIMEOUT`).
    -   The `radiusAuthenticate` function catches the timeout and notifies the `RadiusHostManager`.
    -   The manager immediately initiates a **failover sequence**.

2.  **Proactive Failover (During Health Check)**
    -   The background health check cycle runs.
    -   It probes the current active host, and the probe fails (e.g., times out).
    -   The manager immediately initiates a **failover sequence**.

### The Failover Sequence

When a failover is triggered, the `RadiusHostManager` performs the following steps:

1.  It marks the current active host as potentially down.
2.  It creates a new priority list of hosts to try, starting with the one immediately following the failed host in the original `RADIUS_HOSTS` array and wrapping around.
    -   *Example*: If `RADIUS_HOSTS` is `[A, B, C]` and `A` fails, the failover order will be `B`, then `C`.
3.  It probes the next host in the failover list.
4.  If the host responds, it is immediately promoted to be the new **active host**, and the failover sequence stops.
5.  If the host does not respond, the manager moves to the next host in the sequence and repeats the probe.
6.  If the manager cycles through all other hosts and none of them respond, it will clear the active host. In this state, the next user authentication attempt will trigger a new search for a responsive host from the beginning of the `RADIUS_HOSTS` list.

This ensures that the system can automatically recover from a RADIUS server failure with minimal disruption to users.

## Startup Behavior

On application startup, the `RadiusHostManager` immediately runs a `fastFailoverSequence` to find the first available host and set it as active. This ensures that the proxy is ready to serve authentication requests as quickly as possible, without having to wait for the first user login to discover a working server.
