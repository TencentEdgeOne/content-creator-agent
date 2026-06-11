/**
 * Stop active run — aborts the running generation for this conversation.
 *
 * IMPORTANT: the stop request must carry a makers-conversation-id header
 * (the runtime rejects requests without it), but it should use a DIFFERENT
 * UUID from the chat request to avoid sticky-routing to the busy instance.
 * The target conversation_id is read from the request body.
 */
export async function onRequest(context: any) {
  // /stop endpoint: the frontend MUST pass conversation_id via the body
  // (never carry the header). Body wins; runtime-injected
  // context.conversation_id acts as a fallback.
  const body = (context.request?.body ?? {}) as Record<string, unknown>;
  const conversationId =
    (body.conversation_id as string | undefined) ??
    (body.conversationId as string | undefined) ??
    context.conversation_id;

  if (!conversationId) {
    return new Response(
      JSON.stringify({ error: "Missing conversation_id" }),
      { status: 400, headers: { "Content-Type": "application/json; charset=UTF-8" } },
    );
  }

  const result = context.utils.abortActiveRun(conversationId);

  return new Response(
    JSON.stringify({
      status: result.aborted ? "stopped" : "no_active_run",
      conversationId,
      ...result,
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=UTF-8" } },
  );
}
