import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-sync-secret");

  if (secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiUrl = process.env.RANKING_API_URL!;

  const res = await fetch(apiUrl, {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Ranking API failed: ${res.status}` },
      { status: 500 }
    );
  }

  const apiData = await res.json();

  const eventId = Number(apiData.id);
  const eventName = apiData.name;
  const server = "tw";
  const fetchedAt = new Date().toISOString();
  const rows = apiData.player_top_100_rankings ?? [];

  await supabaseAdmin.from("events").upsert({
    id: eventId,
    name: eventName,
    server,
    starts_at: apiData.start_at,
    ends_at: apiData.closed_at,
  });

  for (const row of rows) {
    const profileId = row.last_player_info?.profile?.id;

    if (!profileId) {
      continue;
    }

    const externalId = String(profileId);
    const name = row.name;
    const rank = Number(row.rank);
    const score = Number(row.score);
    const lastScore = Number(row.last_score ?? 0);
    const lastPlayedAt = row.last_played_at;

    const { data: player, error: playerError } = await supabaseAdmin
      .from("players")
      .upsert(
        {
          server,
          external_id: externalId,
          name,
          updated_at: fetchedAt,
        },
        {
          onConflict: "server,external_id",
        }
      )
      .select()
      .single();

    if (playerError) {
      return NextResponse.json({ error: playerError.message }, { status: 500 });
    }

    const { data: previous } = await supabaseAdmin
      .from("ranking_snapshots")
      .select("id, score, fetched_at")
      .eq("event_id", eventId)
      .eq("server", server)
      .eq("player_id", player.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from("ranking_snapshots")
      .insert({
        event_id: eventId,
        server,
        fetched_at: fetchedAt,
        rank,
        player_id: player.id,
        score,
        raw_data: row,
      })
      .select()
      .single();

    if (snapshotError) {
      return NextResponse.json(
        { error: snapshotError.message },
        { status: 500 }
      );
    }

if (lastPlayedAt && lastScore > 0) {
  const { data: previousPlay } = await supabaseAdmin
    .from("play_records")
    .select("played_at, play_score")
    .eq("event_id", eventId)
    .eq("server", server)
    .eq("player_id", player.id)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recentPlays } = await supabaseAdmin
    .from("play_records")
    .select("play_score")
    .eq("event_id", eventId)
    .eq("server", server)
    .eq("player_id", player.id)
    .eq("source_type", "event")
    .order("played_at", { ascending: false })
    .limit(20);

  let secondsSincePreviousPlay: number | null = null;

  if (previousPlay?.played_at) {
    secondsSincePreviousPlay = Math.floor(
      (new Date(lastPlayedAt).getTime() -
        new Date(previousPlay.played_at).getTime()) /
        1000
    );
  }

  const scores = (recentPlays ?? [])
    .map((play) => Number(play.play_score))
    .filter((score) => score > 0)
    .sort((a, b) => a - b);

  const medianScore =
    scores.length > 0 ? scores[Math.floor(scores.length / 2)] : null;

  const isTooFast =
    secondsSincePreviousPlay !== null &&
    secondsSincePreviousPlay > 0 &&
    secondsSincePreviousPlay < 70;

  const isMuchLowerThanNormal =
    medianScore !== null &&
    medianScore >= 10000 &&
    lastScore < medianScore * 0.25;

  const isMysekai = isTooFast && isMuchLowerThanNormal;
  const sourceType = isMysekai ? "mysekai" : "event";

  await supabaseAdmin.from("play_records").upsert(
    {
      event_id: eventId,
      server,
      player_id: player.id,
      rank,
      score_before: score - lastScore,
      score_after: score,
      play_score: lastScore,
      played_at: lastPlayedAt,
      raw_data: row,
      source_type: sourceType,
      is_mysekai: isMysekai,
      seconds_since_previous_play: secondsSincePreviousPlay,
    },
    {
      onConflict: "event_id,server,player_id,played_at",
    }
  );
}


    if (previous && score > Number(previous.score)) {
      const startedAt = new Date(previous.fetched_at);
      const endedAt = new Date(fetchedAt);
      const secondsElapsed = Math.max(
        1,
        Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
      );

      const deltaScore = score - Number(previous.score);
      const pointsPerHour = (deltaScore * 3600) / secondsElapsed;

      await supabaseAdmin.from("score_deltas").insert({
        event_id: eventId,
        server,
        player_id: player.id,
        from_snapshot_id: previous.id,
        to_snapshot_id: snapshot.id,
        from_score: previous.score,
        to_score: score,
        delta_score: deltaScore,
        started_at: previous.fetched_at,
        ended_at: fetchedAt,
        seconds_elapsed: secondsElapsed,
        points_per_hour: pointsPerHour,
      });

      const { data: activeParking } = await supabaseAdmin
        .from("parking_sessions")
        .select("id, started_at")
        .eq("event_id", eventId)
        .eq("server", server)
        .eq("player_id", player.id)
        .eq("is_active", true)
        .maybeSingle();

      if (activeParking) {
        const parkingStartedAt = new Date(activeParking.started_at);
        const durationSeconds = Math.floor(
          (endedAt.getTime() - parkingStartedAt.getTime()) / 1000
        );

        await supabaseAdmin
          .from("parking_sessions")
          .update({
            ended_at: fetchedAt,
            duration_seconds: durationSeconds,
            is_active: false,
            updated_at: fetchedAt,
          })
          .eq("id", activeParking.id);
      }
    }

    const { data: lastPlay } = await supabaseAdmin
      .from("play_records")
      .select("played_at")
      .eq("event_id", eventId)
      .eq("server", server)
      .eq("player_id", player.id)
      .order("played_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastActiveAt = lastPlay?.played_at ?? previous?.fetched_at;

    if (lastActiveAt) {
      const idleSeconds = Math.floor(
        (new Date(fetchedAt).getTime() - new Date(lastActiveAt).getTime()) /
          1000
      );

      if (idleSeconds >= 600) {
        const { data: activeParking } = await supabaseAdmin
          .from("parking_sessions")
          .select("id")
          .eq("event_id", eventId)
          .eq("server", server)
          .eq("player_id", player.id)
          .eq("is_active", true)
          .maybeSingle();

        if (!activeParking) {
          await supabaseAdmin.from("parking_sessions").insert({
            event_id: eventId,
            server,
            player_id: player.id,
            started_at: lastActiveAt,
            is_active: true,
          });
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    event_name: eventName,
    count: rows.length,
    fetched_at: fetchedAt,
  });
}
