export default {
  async fetch(req: Request): Promise<Response> {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    // begin SSE
    await writer.write(enc.encode("event: open\ndata: ok\n\n"));
    // pretend to stream tokens
    for (const chunk of ["Hello", " there", ", human."]) {
      await new Promise(r=>setTimeout(r, 200));
      await writer.write(enc.encode(`data: ${JSON.stringify({ token: chunk })}\n\n`));
    }
    await writer.write(enc.encode("event: done\ndata: {}\n\n"));
    await writer.close();
    return new Response(readable, { headers: { "content-type":"text/event-stream" }});
  }
};