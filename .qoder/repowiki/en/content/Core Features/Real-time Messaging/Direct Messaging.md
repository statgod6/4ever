# Direct Messaging

<cite>
**Referenced Files in This Document**
- [messaging.module.ts](file://backend/src/messaging/messaging.module.ts)
- [messages.controller.ts](file://backend/src/messaging/messages.controller.ts)
- [messaging.service.ts](file://backend/src/messaging/messaging.service.ts)
- [messaging.gateway.ts](file://backend/src/messaging/messaging.gateway.ts)
- [connections.controller.ts](file://backend/src/messaging/connections.controller.ts)
- [connections.service.ts](file://backend/src/messaging/connections.service.ts)
- [mediator.service.ts](file://backend/src/messaging/mediator.service.ts)
- [shared-notes.service.ts](file://backend/src/messaging/shared-notes.service.ts)
- [messaging.ts](file://frontend/src/api/messaging.ts)
- [messagingStore.ts](file://frontend/src/store/messagingStore.ts)
- [socket.ts](file://frontend/src/api/socket.ts)
- [schema.prisma](file://backend/prisma/schema.prisma)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the direct messaging system, focusing on the end-to-end message lifecycle: creation, validation, delivery, read tracking, reactions, threading with reply-to, metadata handling, tri-chat mediator features, and real-time delivery guarantees via WebSocket. It also documents WebSocket event formats, client-server communication patterns, and practical operation examples.

## Project Structure
The messaging subsystem is organized around NestJS modules and services:
- Messaging module wires dependencies and exposes REST and WebSocket endpoints for direct messaging and tri-chat mediator features.
- Messaging service encapsulates business logic for message CRUD, status updates, reactions, search, and conversation lists.
- Messaging gateway handles WebSocket authentication, rate limiting, input validation, and real-time event broadcasting.
- Connections service manages user discovery, connection requests, and acceptance.
- Mediator service powers tri-chat mediator sessions, streaming, and session management.
- Frontend APIs and stores coordinate REST and WebSocket interactions for UI rendering and real-time updates.

```mermaid
graph TB
subgraph "Backend"
MM["MessagingModule<br/>imports: PrismaModule, OntologyModule, JwtModule"]
MC["MessagesController"]
MSGW["MessagingGateway"]
MS["MessagingService"]
CS["ConnectionsService"]
MED["MediatorService"]
SN["SharedNotesService"]
end
subgraph "Frontend"
FE_MSG_API["messagesApi (REST)"]
FE_WS["socket.ts (WebSocket)"]
FE_STORE["messagingStore (Zustand)"]
end
MM --> MC
MM --> MSGW
MM --> MS
MM --> CS
MM --> MED
MM --> SN
FE_MSG_API --> MC
FE_WS --> MSGW
FE_STORE --> FE_MSG_API
FE_STORE --> FE_WS
```

**Diagram sources**
- [messaging.module.ts:14-36](file://backend/src/messaging/messaging.module.ts#L14-L36)
- [messages.controller.ts:21-27](file://backend/src/messaging/messages.controller.ts#L21-L27)
- [messaging.gateway.ts:55-62](file://backend/src/messaging/messaging.gateway.ts#L55-L62)
- [messaging.service.ts:21-28](file://backend/src/messaging/messaging.service.ts#L21-L28)
- [connections.service.ts:6-8](file://backend/src/messaging/connections.service.ts#L6-L8)
- [mediator.service.ts:131-134](file://backend/src/messaging/mediator.service.ts#L131-L134)
- [shared-notes.service.ts:4-6](file://backend/src/messaging/shared-notes.service.ts#L4-L6)
- [messaging.ts:147-217](file://frontend/src/api/messaging.ts#L147-L217)
- [socket.ts:10-30](file://frontend/src/api/socket.ts#L10-L30)
- [messagingStore.ts:72-70](file://frontend/src/store/messagingStore.ts#L72-L70)

**Section sources**
- [messaging.module.ts:14-36](file://backend/src/messaging/messaging.module.ts#L14-L36)
- [messages.controller.ts:21-27](file://backend/src/messaging/messages.controller.ts#L21-L27)
- [messaging.gateway.ts:55-62](file://backend/src/messaging/messaging.gateway.ts#L55-L62)
- [messaging.service.ts:21-28](file://backend/src/messaging/messaging.service.ts#L21-L28)
- [connections.service.ts:6-8](file://backend/src/messaging/connections.service.ts#L6-L8)
- [mediator.service.ts:131-134](file://backend/src/messaging/mediator.service.ts#L131-L134)
- [shared-notes.service.ts:4-6](file://backend/src/messaging/shared-notes.service.ts#L4-L6)
- [messaging.ts:147-217](file://frontend/src/api/messaging.ts#L147-L217)
- [socket.ts:10-30](file://frontend/src/api/socket.ts#L10-L30)
- [messagingStore.ts:72-70](file://frontend/src/store/messagingStore.ts#L72-L70)

## Core Components
- MessagingService: Validates connections, persists messages, emits relational ontology events, logs bidirectional interactions, manages reactions, read status, and conversation queries.
- MessagingGateway: Authenticates WebSocket clients, enforces rate limits, validates payloads, streams mediator responses, and broadcasts real-time events scoped to participants.
- MediatorService: Manages tri-chat mediator toggles, session lifecycles, context building, streaming, and action cards.
- ConnectionsService: User discovery, connection requests, acceptance, and mirror-circle linkage.
- Frontend messaging API and Zustand store: REST endpoints for conversations and actions, and WebSocket handlers for real-time updates.

**Section sources**
- [messaging.service.ts:21-647](file://backend/src/messaging/messaging.service.ts#L21-L647)
- [messaging.gateway.ts:62-762](file://backend/src/messaging/messaging.gateway.ts#L62-L762)
- [mediator.service.ts:131-800](file://backend/src/messaging/mediator.service.ts#L131-L800)
- [connections.service.ts:6-385](file://backend/src/messaging/connections.service.ts#L6-L385)
- [messaging.ts:147-217](file://frontend/src/api/messaging.ts#L147-L217)
- [messagingStore.ts:72-412](file://frontend/src/store/messagingStore.ts#L72-L412)

## Architecture Overview
The system integrates REST and WebSocket:
- REST endpoints under /messages manage conversations, read status, reactions, settings, and tri-chat mediator operations.
- WebSocket (/ws) authenticates via JWT, scopes rooms by user, and streams real-time updates including messages, reactions, mediator chunks, and session events.

```mermaid
sequenceDiagram
participant Client as "Frontend Client"
participant REST as "MessagesController"
participant WS as "MessagingGateway"
participant SVC as "MessagingService"
participant DB as "Prisma"
Client->>REST : POST /messages/ : userId (send_message)
REST->>SVC : sendMessage(senderId, receiverId, content, options)
SVC->>DB : create directMessage
SVC-->>WS : emit new_message
WS-->>Client : message_sent (echo with clientTempId)
WS-->>Client : new_message (to receiver room)
WS->>SVC : updateMessageStatus(messageId, delivered)
SVC->>DB : update status
WS-->>Client : message_status delivered
```

**Diagram sources**
- [messages.controller.ts:64-77](file://backend/src/messaging/messages.controller.ts#L64-L77)
- [messaging.gateway.ts:191-247](file://backend/src/messaging/messaging.gateway.ts#L191-L247)
- [messaging.service.ts:53-96](file://backend/src/messaging/messaging.service.ts#L53-L96)

## Detailed Component Analysis

### Message Sending Workflow
- Validation and rate limiting occur in the WebSocket handler before invoking MessagingService.
- MessagingService persists the message, emits relational events for auto-logging, and returns the enriched message with sender/receiver/replyTo/reactions included.
- Real-time delivery confirmation updates status to delivered when the receiver is online.

```mermaid
sequenceDiagram
participant Client as "Client"
participant GW as "MessagingGateway"
participant SVC as "MessagingService"
participant DB as "Prisma"
Client->>GW : emit "send_message" {receiverId, content, replyToId?, messageType?, metadata?}
GW->>GW : validate payload and rate limit
GW->>SVC : sendMessage(...)
SVC->>DB : create directMessage
SVC-->>GW : message (with relations)
GW-->>Client : message_sent (includes clientTempId)
GW-->>Client : new_message (to receiver room)
alt receiver online
GW->>SVC : updateMessageStatus(..., delivered)
SVC->>DB : update
GW-->>Client : message_status delivered
end
```

**Diagram sources**
- [messaging.gateway.ts:191-247](file://backend/src/messaging/messaging.gateway.ts#L191-L247)
- [messaging.service.ts:53-96](file://backend/src/messaging/messaging.service.ts#L53-L96)

**Section sources**
- [messaging.gateway.ts:191-247](file://backend/src/messaging/messaging.gateway.ts#L191-L247)
- [messaging.service.ts:53-96](file://backend/src/messaging/messaging.service.ts#L53-L96)

### Content Validation and Rate Limiting
- Payload validation enforces string length limits and presence checks for required fields.
- Sliding-window rate limits per event and per user prevent abuse.
- Rate limit enforcement returns structured errors to the client.

```mermaid
flowchart TD
Start(["Receive WebSocket Event"]) --> Validate["Validate types and lengths"]
Validate --> Valid{"Valid?"}
Valid --> |No| RejectInvalid["Emit message_error INVALID_INPUT"]
Valid --> |Yes| CheckRate["Check sliding-window rate limit"]
CheckRate --> Allowed{"Allowed?"}
Allowed --> |No| RejectRate["Emit message_error RATE_LIMIT"]
Allowed --> |Yes| Process["Invoke service handler"]
RejectInvalid --> End(["Done"])
RejectRate --> End
Process --> End
```

**Diagram sources**
- [messaging.gateway.ts:105-126](file://backend/src/messaging/messaging.gateway.ts#L105-L126)
- [messaging.gateway.ts:91-103](file://backend/src/messaging/messaging.gateway.ts#L91-L103)

**Section sources**
- [messaging.gateway.ts:105-126](file://backend/src/messaging/messaging.gateway.ts#L105-L126)
- [messaging.gateway.ts:91-103](file://backend/src/messaging/messaging.gateway.ts#L91-L103)

### Delivery Confirmation and Read Tracking
- On connect, pending messages to the user are marked delivered.
- When the receiver is online, delivery is confirmed immediately upon persistence.
- Read tracking supports per-conversation mark-as-read and global unread counts.

```mermaid
sequenceDiagram
participant Client as "Client"
participant GW as "MessagingGateway"
participant SVC as "MessagingService"
participant DB as "Prisma"
Client->>GW : connect (authenticated)
GW->>SVC : markAsDelivered(userId)
SVC->>DB : updateMany status=sent -> delivered
Client->>GW : emit "mark_read" {otherUserId}
GW->>SVC : markAsRead(userId, otherUserId)
SVC->>DB : updateMany isRead=false -> isRead=true, status=read
GW-->>Client : messages_read {readBy : otherUserId}
```

**Diagram sources**
- [messaging.gateway.ts:127-160](file://backend/src/messaging/messaging.gateway.ts#L127-L160)
- [messaging.gateway.ts:364-384](file://backend/src/messaging/messaging.gateway.ts#L364-L384)
- [messaging.service.ts:231-241](file://backend/src/messaging/messaging.service.ts#L231-L241)
- [messaging.service.ts:614-624](file://backend/src/messaging/messaging.service.ts#L614-L624)

**Section sources**
- [messaging.gateway.ts:127-160](file://backend/src/messaging/messaging.gateway.ts#L127-L160)
- [messaging.gateway.ts:364-384](file://backend/src/messaging/messaging.gateway.ts#L364-L384)
- [messaging.service.ts:231-241](file://backend/src/messaging/messaging.service.ts#L231-L241)
- [messaging.service.ts:614-624](file://backend/src/messaging/messaging.service.ts#L614-L624)

### Message Threading and Reply-To Functionality
- Messages can reference a parent via replyToId; the service includes replyTo metadata with sender name.
- Conversation retrieval filters by connection and optional per-user cleared timestamps for tri-chat continuity.

```mermaid
erDiagram
DIRECT_MESSAGE {
uuid id PK
uuid sender_id FK
uuid receiver_id FK
uuid reply_to_id FK
string content
string message_type
jsonb metadata
boolean is_read
enum status
uuid mediator_session_id
datetime created_at
datetime updated_at
datetime edited_at
datetime deleted_at
}
USER {
uuid id PK
string name
}
DIRECT_MESSAGE ||--|| USER : "sender"
DIRECT_MESSAGE ||--|| USER : "receiver"
DIRECT_MESSAGE }|--|| DIRECT_MESSAGE : "reply_to"
```

**Diagram sources**
- [schema.prisma](file://backend/prisma/schema.prisma)
- [messaging.service.ts:6-19](file://backend/src/messaging/messaging.service.ts#L6-L19)
- [messaging.service.ts:460-503](file://backend/src/messaging/messaging.service.ts#L460-L503)

**Section sources**
- [schema.prisma](file://backend/prisma/schema.prisma)
- [messaging.service.ts:6-19](file://backend/src/messaging/messaging.service.ts#L6-L19)
- [messaging.service.ts:460-503](file://backend/src/messaging/messaging.service.ts#L460-L503)

### Metadata Handling
- Messages support arbitrary JSON metadata for extended features (e.g., mediator placeholders).
- Metadata is stored and returned with message payloads.

**Section sources**
- [messaging.service.ts:64-75](file://backend/src/messaging/messaging.service.ts#L64-L75)
- [messaging.gateway.ts:200-201](file://backend/src/messaging/messaging.gateway.ts#L200-L201)

### Message Lifecycle: Creation → Delivery → Read → Deletion
- Creation: validate connection, persist message, emit relational events.
- Delivery: mark delivered on connect or when receiver is online.
- Read: mark as read per conversation and globally.
- Deletion: soft-delete with content cleared and deletedAt timestamp.

```mermaid
stateDiagram-v2
[*] --> Created
Created --> Sent : "persisted"
Sent --> Delivered : "receiver online"
Sent --> Read : "mark_as_read"
Delivered --> Read : "mark_as_read"
Created --> Deleted : "soft-delete"
Read --> Deleted : "soft-delete"
```

**Diagram sources**
- [messaging.service.ts:53-96](file://backend/src/messaging/messaging.service.ts#L53-L96)
- [messaging.service.ts:217-225](file://backend/src/messaging/messaging.service.ts#L217-L225)
- [messaging.service.ts:614-624](file://backend/src/messaging/messaging.service.ts#L614-L624)
- [messaging.service.ts:164-174](file://backend/src/messaging/messaging.service.ts#L164-L174)

**Section sources**
- [messaging.service.ts:53-96](file://backend/src/messaging/messaging.service.ts#L53-L96)
- [messaging.service.ts:217-225](file://backend/src/messaging/messaging.service.ts#L217-L225)
- [messaging.service.ts:614-624](file://backend/src/messaging/messaging.service.ts#L614-L624)
- [messaging.service.ts:164-174](file://backend/src/messaging/messaging.service.ts#L164-L174)

### Reactions and Read Status Tracking
- Reactions are upsert toggles scoped to conversation participants.
- Read status updates are applied per conversation and reflected in UI badges.

**Section sources**
- [messaging.service.ts:179-202](file://backend/src/messaging/messaging.service.ts#L179-L202)
- [messaging.gateway.ts:318-360](file://backend/src/messaging/messaging.gateway.ts#L318-L360)
- [messaging.service.ts:614-624](file://backend/src/messaging/messaging.service.ts#L614-L624)

### Tri-Chat Mediator: Session Management and Streaming
- Toggle mediator enablement per connection; status includes turns-left and active session.
- Summons create a placeholder mediator message and stream deltas to both parties.
- Sessions auto-end after idle timeout; replies persist user input tied to the session.

```mermaid
sequenceDiagram
participant Client as "Client"
participant GW as "MessagingGateway"
participant MED as "MediatorService"
participant DB as "Prisma"
Client->>GW : emit "summon_mediator" {connectionId}
GW->>MED : summonMediator(userId, connectionId)
MED->>DB : create placeholder message (messageType=mediator)
MED-->>GW : stream deltas
GW-->>Client : mediator_chunk (delta)
GW-->>Client : mediator_complete (sessionId)
Client->>GW : emit "reply_to_mediator" {connectionId, sessionId, text}
GW->>MED : summonMediator(..., {sessionId, replyText})
MED->>DB : create reply DM (optional)
MED->>DB : create placeholder DM
GW-->>Client : mediator_typing + mediator_chunk...
```

**Diagram sources**
- [messaging.gateway.ts:484-544](file://backend/src/messaging/messaging.gateway.ts#L484-L544)
- [messaging.gateway.ts:548-617](file://backend/src/messaging/messaging.gateway.ts#L548-L617)
- [mediator.service.ts:661-800](file://backend/src/messaging/mediator.service.ts#L661-L800)

**Section sources**
- [messaging.gateway.ts:484-544](file://backend/src/messaging/messaging.gateway.ts#L484-L544)
- [messaging.gateway.ts:548-617](file://backend/src/messaging/messaging.gateway.ts#L548-L617)
- [mediator.service.ts:661-800](file://backend/src/messaging/mediator.service.ts#L661-L800)

### WebSocket Event Types and Formats
Common events include:
- Outbound: new_message, message_sent, message_error, message_status, reaction_updated, messages_read, user_online, user_offline, mediator_chunk, mediator_complete, mediator_error, mediator_typing, tri_chat_toggled, mediator_session_ended, mediator_renamed, mediator_cancelled, chat_history_cleared, mediator_action_accepted.
- Inbound: send_message, edit_message, delete_message, toggle_reaction, mark_read, typing, get_online_status, get_last_seen, toggle_tri_chat, summon_mediator, reply_to_mediator, end_mediator_session, clear_chat_history, rename_mediator, accept_mediator_action.

**Section sources**
- [messaging.gateway.ts:191-762](file://backend/src/messaging/messaging.gateway.ts#L191-L762)

### Practical Examples of Message Operations
- Send a message: emit "send_message" with receiverId, content, optional replyToId, messageType, metadata; expect "message_sent" echo and "new_message" delivery.
- Edit a message: PUT /messages/{messageId}/edit; expect "message_edited" broadcast.
- Delete a message: DELETE /messages/{messageId}; expect "message_deleted" broadcast.
- Add reaction: POST /messages/{messageId}/reactions; expect "reaction_updated" in both rooms.
- Mark read: emit "mark_read"; expect "messages_read" to the other party.
- Tri-chat mediator: emit "summon_mediator" or "reply_to_mediator"; expect "mediator_chunk" streams and "mediator_complete".

**Section sources**
- [messaging.gateway.ts:191-384](file://backend/src/messaging/messaging.gateway.ts#L191-L384)
- [messages.controller.ts:64-112](file://backend/src/messaging/messages.controller.ts#L64-L112)
- [messaging.ts:163-170](file://frontend/src/api/messaging.ts#L163-L170)
- [messagingStore.ts:185-280](file://frontend/src/store/messagingStore.ts#L185-L280)

### Client-Server Communication Patterns
- REST: JWT-protected endpoints for conversations, reactions, settings, and mediator operations.
- WebSocket: Authenticated rooms per user; events scoped to participants; sliding-window rate limits; input sanitization and bounded payloads.

**Section sources**
- [messages.controller.ts:21-27](file://backend/src/messaging/messages.controller.ts#L21-L27)
- [messaging.gateway.ts:127-180](file://backend/src/messaging/messaging.gateway.ts#L127-L180)
- [socket.ts:10-30](file://frontend/src/api/socket.ts#L10-L30)

## Dependency Analysis
```mermaid
classDiagram
class MessagingModule
class MessagesController
class MessagingGateway
class MessagingService
class ConnectionsService
class MediatorService
class SharedNotesService
MessagingModule --> MessagesController : "exports"
MessagingModule --> MessagingGateway : "exports"
MessagingModule --> MessagingService : "provides"
MessagingModule --> ConnectionsService : "provides"
MessagingModule --> MediatorService : "provides"
MessagingModule --> SharedNotesService : "provides"
```

**Diagram sources**
- [messaging.module.ts:14-36](file://backend/src/messaging/messaging.module.ts#L14-L36)

**Section sources**
- [messaging.module.ts:14-36](file://backend/src/messaging/messaging.module.ts#L14-L36)

## Performance Considerations
- Conversation listing uses a single optimized query with DISTINCT ON and grouped unread counts to avoid O(N) queries.
- Pagination uses cursor-based pagination with reverse ordering to minimize overhead.
- Rate-limit counters are periodically cleaned to prevent unbounded growth.
- Mediator context is truncated to a maximum character limit to maintain performance.

**Section sources**
- [messaging.service.ts:514-609](file://backend/src/messaging/messaging.service.ts#L514-L609)
- [messaging.gateway.ts:80-87](file://backend/src/messaging/messaging.gateway.ts#L80-L87)
- [mediator.service.ts:636-650](file://backend/src/messaging/mediator.service.ts#L636-L650)

## Troubleshooting Guide
- Authentication failures: ensure JWT token is present and valid; gateway disconnects invalid sockets.
- Rate limit exceeded: slow down or wait; client receives structured error with code RATE_LIMIT.
- Invalid input: client receives message_error with INVALID_INPUT and details.
- Connection not accepted: ensure users are connected before messaging; validation throws forbidden.
- Mediator not configured: missing API key prevents mediator summoning.
- Read receipts: if not received, verify online status and that mark_read was emitted.

**Section sources**
- [messaging.gateway.ts:127-160](file://backend/src/messaging/messaging.gateway.ts#L127-L160)
- [messaging.gateway.ts:111-126](file://backend/src/messaging/messaging.gateway.ts#L111-L126)
- [messaging.service.ts:33-47](file://backend/src/messaging/messaging.service.ts#L33-L47)
- [mediator.service.ts:698-700](file://backend/src/messaging/mediator.service.ts#L698-L700)

## Conclusion
The direct messaging system combines robust validation, rate limiting, and real-time delivery guarantees with flexible threading, reactions, and tri-chat mediator capabilities. REST and WebSocket pathways complement each other to provide responsive, privacy-conscious chat experiences.

## Appendices

### Database Schema Highlights
- Users, DirectMessages, MessageReactions, Connections, SharedNotes, MediationSessions are central to messaging and mediator features.
- Message status transitions and read flags are tracked per message.
- Mediator sessions and actions are persisted alongside messages for continuity.

**Section sources**
- [schema.prisma](file://backend/prisma/schema.prisma)