import type { Forecast, Preferences, RankedActivity, RecommendationResult } from "./types";

type AiRecommendation = {
  activityId: string;
  score?: number;
  reason?: string;
  safetyNotes?: string[];
};

type AiPayload = {
  recommendations?: AiRecommendation[];
  outfit?: string;
  smsCopy?: string;
};

const model = process.env.OPENAI_RECOMMENDATION_MODEL ?? "gpt-5.4-mini";

export async function enhanceWithOpenAI(input: {
  preferences: Preferences;
  forecast: Forecast;
  candidates: RankedActivity[];
  localOutfit: string;
}): Promise<Pick<RecommendationResult, "recommendations" | "outfit" | "smsCopy" | "source">> {
  if (!process.env.OPENAI_API_KEY) {
    return localRecommendation(input);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "You are Sunwise, a weather-aware summer activity recommender. Respect hard safety constraints, avoid medical claims, and return only schema-valid JSON."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Rank and personalize the candidate activities for today's summer forecast.",
              forecast: input.forecast,
              preferences: input.preferences,
              candidates: input.candidates.map((activity) => ({
                id: activity.id,
                title: activity.title,
                time: activity.time,
                score: activity.score,
                weatherScore: activity.weatherScore,
                weatherFit: activity.weatherFit,
                weatherReason: activity.weatherReason,
                reason: activity.reason,
                safetyNotes: activity.safetyNotes,
                cost: activity.cost,
                venue: activity.venue,
                intensity: activity.intensity,
                hobbies: activity.hobbies
              })),
              localOutfit: input.localOutfit
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "sunwise_recommendation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["recommendations", "outfit", "smsCopy"],
              properties: {
                recommendations: {
                  type: "array",
                  minItems: 1,
                  maxItems: 4,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["activityId", "score", "reason", "safetyNotes"],
                    properties: {
                      activityId: { type: "string" },
                      score: { type: "number" },
                      reason: { type: "string" },
                      safetyNotes: { type: "array", items: { type: "string" } }
                    }
                  }
                },
                outfit: { type: "string" },
                smsCopy: { type: "string" }
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      return localRecommendation(input);
    }

    const data = await response.json();
    const text = extractOutputText(data);
    if (!text) {
      return localRecommendation(input);
    }

    const aiPayload = JSON.parse(text) as AiPayload;
    const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
    const recommendations = (aiPayload.recommendations ?? [])
      .reduce<RankedActivity[]>((items, item) => {
        const candidate = byId.get(item.activityId);
        if (!candidate) return items;
        items.push({
          ...candidate,
          score:
            typeof item.score === "number"
              ? Math.max(25, Math.min(98, Math.min(candidate.score + 8, Math.round(item.score))))
              : candidate.score,
          aiReason: item.reason,
          safetyNotes: item.safetyNotes?.length ? item.safetyNotes : candidate.safetyNotes
        });
        return items;
      }, []);

    if (!recommendations.length) {
      return localRecommendation(input);
    }

    return {
      source: "openai",
      recommendations,
      outfit: aiPayload.outfit ?? input.localOutfit,
      smsCopy: aiPayload.smsCopy ?? buildSmsCopy(input.forecast, recommendations[0])
    };
  } catch {
    return localRecommendation(input);
  }
}

function localRecommendation(input: {
  forecast: Forecast;
  candidates: RankedActivity[];
  localOutfit: string;
}): Pick<RecommendationResult, "recommendations" | "outfit" | "smsCopy" | "source"> {
  return {
    source: "local",
    recommendations: input.candidates,
    outfit: input.localOutfit,
    smsCopy: buildSmsCopy(input.forecast, input.candidates[0])
  };
}

function buildSmsCopy(forecast: Forecast, top?: RankedActivity) {
  if (!top) {
    return `Sunwise: ${forecast.summary}, ${forecast.temperatureC}C. Check the app for today's plan.`;
  }
  return `Sunwise: ${forecast.summary}, ${forecast.temperatureC}C, feels like ${forecast.feelsLikeC}. Best pick: ${top.title} during ${top.time}.`;
}

function extractOutputText(data: unknown) {
  const output = (data as { output?: Array<{ content?: Array<{ text?: string }> }> }).output;
  return output?.flatMap((item) => item.content ?? []).find((content) => typeof content.text === "string")?.text;
}
