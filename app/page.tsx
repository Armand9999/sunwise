"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { activities, defaultForecast, defaultPreferences, hobbyOptions, hourly } from "@/lib/sunwise/data";
import { outfitFor, rankActivities } from "@/lib/sunwise/guardrails";
import type { Hobby, Intensity, Preferences, RecommendationResult, Style, Venue } from "@/lib/sunwise/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type PreferenceRow = {
  hobbies: Hobby[] | null;
  intensity: Intensity | null;
  venue: Venue | null;
  heat_sensitive: boolean | null;
  sun_sensitive: boolean | null;
  budget: number | null;
  accessibility: boolean | null;
  outfit_style: Style | null;
};

type ProfileRow = {
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_source: "manual" | "browser" | null;
  phone_e164: string | null;
  sms_enabled: boolean | null;
  sms_verified_at: string | null;
  sms_verified_phone_e164: string | null;
  sms_consent_at: string | null;
  daily_send_time: string | null;
};

type RecommendationRow = {
  created_at: string;
  guardrails_applied: string[];
  model: string | null;
  outfit: string;
  recommendations: RecommendationResult["recommendations"];
  sms_copy: string;
  source: RecommendationResult["source"];
};

type SmsStatus = {
  phone: string | null;
  enabled: boolean;
  verified: boolean;
  consented: boolean;
  optedOut: boolean;
  smsVerifiedAt: string | null;
  smsConsentAt: string | null;
  smsOptedOutAt: string | null;
  nextSend: { date: string; time: string; timezone: string } | null;
  eligible: boolean;
  latestDelivery: {
    delivery_date: string;
    status: string;
    provider: string | null;
    error: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  latestRun: {
    trigger_source: string;
    status: string;
    checked: number;
    due: number;
    sent: number;
    failed: number;
    started_at: string;
    finished_at: string | null;
  } | null;
};

function formatSendTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

function normalizeTime(time: string | null | undefined) {
  return time?.slice(0, 5) || defaultPreferences.sendTime;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidE164(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

const SMS_CONSENT_TEXT =
  "I agree to receive recurring automated daily Sunwise weather and activity text messages. Message and data rates may apply. Reply STOP to opt out.";

function smsStatusTone(status?: string | null) {
  if (status === "sent" || status === "completed") {
    return "good";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "skipped" || status === "dry_run") {
    return "warn";
  }
  return "soft";
}

function formatStatusDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

function formatEventDate(event: RecommendationResult["events"][number]) {
  const date = new Date(`${event.localDate}T${event.localTime || "12:00:00"}`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: event.localTime ? "numeric" : undefined,
    minute: event.localTime ? "2-digit" : undefined
  }).format(date);
}

function dbRowsToPreferences(profile: ProfileRow | null, preference: PreferenceRow | null): Preferences {
  return {
    ...defaultPreferences,
    location: profile?.location || defaultPreferences.location,
    latitude: profile?.latitude ?? null,
    longitude: profile?.longitude ?? null,
    locationAccuracyM: profile?.location_accuracy_m ?? null,
    locationSource: profile?.location_source || "manual",
    smsEnabled: profile?.sms_enabled ?? defaultPreferences.smsEnabled,
    sendTime: normalizeTime(profile?.daily_send_time),
    hobbies: preference?.hobbies?.length ? preference.hobbies : defaultPreferences.hobbies,
    intensity: preference?.intensity || defaultPreferences.intensity,
    venue: preference?.venue || defaultPreferences.venue,
    heatSensitive: preference?.heat_sensitive ?? defaultPreferences.heatSensitive,
    sunSensitive: preference?.sun_sensitive ?? defaultPreferences.sunSensitive,
    budget: preference?.budget ?? defaultPreferences.budget,
    accessibility: preference?.accessibility ?? defaultPreferences.accessibility,
    style: preference?.outfit_style || defaultPreferences.style
  };
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v3M12 18.5v3M4.9 4.9 7 7M17 17l2.1 2.1M2.5 12h3M18.5 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </>
      )}
      {name === "cloud" && <path d="M6.5 18h10.2a4.4 4.4 0 0 0 .3-8.8A6.3 6.3 0 0 0 5.1 11 3.6 3.6 0 0 0 6.5 18Z" />}
      {name === "rain" && (
        <>
          <path d="M6.5 15.5h10.2a4.1 4.1 0 0 0 .3-8.2A6 6 0 0 0 5.2 9.2a3.4 3.4 0 0 0 1.3 6.3Z" />
          <path d="m8 18-1 2M13 18l-1 2M18 18l-1 2" />
        </>
      )}
      {name === "message" && <path d="M5 5.5h14v9.8H9.4L5 19.1V5.5Z" />}
      {name === "shirt" && <path d="M9 4.5 12 6l3-1.5 4 3-2.2 3L15 9.4v10.1H9V9.4l-1.8 1.1L5 7.5l4-3Z" />}
      {name === "check" && <path d="m5 12.5 4.2 4.2L19 7" />}
    </svg>
  );
}

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [selected, setSelected] = useState(0);
  const [saved, setSaved] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(Boolean(supabase));
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [smsVerifiedAt, setSmsVerifiedAt] = useState("");
  const [smsConsentAt, setSmsConsentAt] = useState("");
  const [smsConsentAccepted, setSmsConsentAccepted] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [signupNeedsConfirmation, setSignupNeedsConfirmation] = useState(false);
  const [recommendationResult, setRecommendationResult] = useState<RecommendationResult | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [lastSavedPlanAt, setLastSavedPlanAt] = useState("");
  const [smsStatus, setSmsStatus] = useState<SmsStatus | null>(null);
  const [isSmsStatusLoading, setIsSmsStatusLoading] = useState(false);
  const [smsStatusMessage, setSmsStatusMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");

  const loadProfile = useCallback(
    async (user: User) => {
      if (!supabase) {
        return;
      }

      const [profileResponse, preferenceResponse, recommendationResponse] = await Promise.all([
        supabase
          .from("profiles")
          .select("location, latitude, longitude, location_accuracy_m, location_source, phone_e164, sms_enabled, sms_verified_at, sms_verified_phone_e164, sms_consent_at, daily_send_time")
          .eq("id", user.id)
          .maybeSingle<ProfileRow>(),
        supabase
          .from("preference_profiles")
          .select("hobbies, intensity, venue, heat_sensitive, sun_sensitive, budget, accessibility, outfit_style")
          .eq("user_id", user.id)
          .maybeSingle<PreferenceRow>(),
        supabase
          .from("daily_recommendations")
          .select("created_at, guardrails_applied, model, outfit, recommendations, sms_copy, source")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<RecommendationRow>()
      ]);

      if (!profileResponse.error && !preferenceResponse.error) {
        setPreferences(dbRowsToPreferences(profileResponse.data, preferenceResponse.data));
        setPhoneNumber(profileResponse.data?.phone_e164 || "");
        setVerifiedPhone(profileResponse.data?.sms_verified_phone_e164 || "");
        setSmsVerifiedAt(profileResponse.data?.sms_verified_at || "");
        setSmsConsentAt(profileResponse.data?.sms_consent_at || "");
        setSmsConsentAccepted(Boolean(profileResponse.data?.sms_consent_at));
        setSaved(true);
      }

      if (!recommendationResponse.error && recommendationResponse.data) {
        setRecommendationResult({
          source: recommendationResponse.data.source,
          generatedAt: recommendationResponse.data.created_at,
          forecast: { ...defaultForecast, location: profileResponse.data?.location || defaultForecast.location },
          recommendations: recommendationResponse.data.recommendations,
          events: [],
          outfit: recommendationResponse.data.outfit,
          smsCopy: recommendationResponse.data.sms_copy,
          guardrailsApplied: recommendationResponse.data.guardrails_applied
        });
        setLastSavedPlanAt(recommendationResponse.data.created_at);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }
      setSession(data.session);
      setIsAuthLoading(false);
      if (data.session?.user) {
        void loadProfile(data.session.user);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        void loadProfile(nextSession.user);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [loadProfile, supabase]);

  const localActivities = useMemo(
    () => rankActivities(activities, preferences, { ...defaultForecast, location: preferences.location }),
    [preferences]
  );
  const rankedActivities = recommendationResult?.recommendations ?? localActivities;
  const topActivity = rankedActivities[selected] ?? rankedActivities[0];
  const displayForecast = recommendationResult?.forecast ?? { ...defaultForecast, location: preferences.location };
  const displayHourly = displayForecast.hourly ?? hourly ?? [];
  const displayLocation =
    preferences.locationSource === "browser" && preferences.location.startsWith("Current location (")
      ? "Current location"
      : displayForecast.location;
  const outfit = recommendationResult?.outfit ?? outfitFor(preferences, displayForecast);
  const smsCopy = recommendationResult?.smsCopy;
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());
  const phoneFormatReady = isValidE164(phoneNumber);
  const phoneVerified = phoneFormatReady && verifiedPhone === phoneNumber && Boolean(smsVerifiedAt);
  const smsConsentReady = phoneVerified && Boolean(smsConsentAt) && smsConsentAccepted;
  const phoneIsReady = !preferences.smsEnabled || (phoneVerified && smsConsentReady);
  const authCanSubmit = isValidEmail(email) && password.length >= 6 && !isAuthLoading;
  const onboardingItems = [
    { label: session ? "Account signed in" : signupNeedsConfirmation ? "Confirm email" : "Create account", done: Boolean(session) },
    { label: "Location set", done: preferences.location.trim().length > 1 },
    { label: preferences.smsEnabled ? "Phone verified" : "Texts optional", done: phoneIsReady },
    { label: "Hobbies selected", done: preferences.hobbies.length > 0 },
    { label: "First plan saved", done: Boolean(recommendationResult || lastSavedPlanAt) }
  ];
  const onboardingDone = onboardingItems.filter((item) => item.done).length;

  const updatePreferences = (next: Preferences) => {
    setSaved(false);
    setRecommendationResult(null);
    setLastSavedPlanAt("");
    setGenerationError("");
    setSelected(0);
    setPreferences(next);
  };

  const toggleHobby = (hobby: Hobby) => {
    updatePreferences({
      ...preferences,
      hobbies: preferences.hobbies.includes(hobby)
        ? preferences.hobbies.filter((item) => item !== hobby)
        : [...preferences.hobbies, hobby]
    });
  };

  const useBrowserLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationMessage("Browser location is not available here.");
      return;
    }

    setIsLocating(true);
    setLocationMessage("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const coordinateFallback = `Current location (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
        let nextLocation = coordinateFallback;

        setLocationMessage("Finding location name...");

        try {
          const response = await fetch(
            `/api/location/reverse-geocode?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
          );
          const payload = await response.json();
          if (response.ok && payload.label) {
            nextLocation = payload.label;
          }
        } catch {
          nextLocation = coordinateFallback;
        }

        updatePreferences({
          ...preferences,
          location: nextLocation,
          latitude,
          longitude,
          locationAccuracyM: Math.round(position.coords.accuracy),
          locationSource: "browser"
        });
        setIsLocating(false);
        setLocationMessage(
          nextLocation === coordinateFallback
            ? `Using browser coordinates. Accuracy about ${Math.round(position.coords.accuracy)} m.`
            : `Using ${nextLocation}. Accuracy about ${Math.round(position.coords.accuracy)} m.`
        );
      },
      (error) => {
        setIsLocating(false);
        setLocationMessage(error.message || "Could not access browser location.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 15 * 60 * 1000 }
    );
  };

  const handleAuth = async () => {
    if (!supabase) {
      setAuthMessage("Add NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local to enable sign up.");
      return;
    }

    if (!isValidEmail(email) || password.length < 6) {
      setAuthMessage("Use a valid email and a password with at least 6 characters.");
      return;
    }

    setAuthMessage("");
    setIsAuthLoading(true);
    const credentials = { email, password, options: { data: { display_name: email.split("@")[0] } } };
    const response =
      authMode === "signup"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword({ email, password });

    setIsAuthLoading(false);

    if (response.error) {
      setAuthMessage(response.error.message);
      return;
    }

    if (authMode === "signup" && !response.data.session) {
      setSignupNeedsConfirmation(true);
      setAuthMessage("Account created. Check your email to confirm, then sign in.");
      return;
    }

    setSignupNeedsConfirmation(false);
    setAuthMessage(authMode === "signup" ? "Account created and signed in." : "Signed in.");
  };

  const resendConfirmation = async () => {
    if (!supabase || !isValidEmail(email)) {
      setAuthMessage("Enter the email you used to sign up.");
      return;
    }

    const response = await supabase.auth.resend({ type: "signup", email });
    setAuthMessage(response.error ? response.error.message : "Confirmation email sent again.");
  };

  const signOut = async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
    setSession(null);
    setSaved(false);
    setRecommendationResult(null);
    setLastSavedPlanAt("");
  };

  const authHeader = async () => {
    if (!supabase) {
      return null;
    }

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
  };

  const refreshSmsStatus = useCallback(async () => {
    if (!session?.user) {
      setSmsStatus(null);
      return;
    }

    const headers = await authHeader();
    if (!headers) {
      return;
    }

    setIsSmsStatusLoading(true);
    setSmsStatusMessage("");

    try {
      const response = await fetch("/api/sms-status", { headers });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not load text status.");
      }
      setSmsStatus(payload as SmsStatus);
    } catch (error) {
      setSmsStatusMessage(error instanceof Error ? error.message : "Could not load text status.");
    } finally {
      setIsSmsStatusLoading(false);
    }
  }, [session?.user, supabase]);

  useEffect(() => {
    void refreshSmsStatus();
  }, [refreshSmsStatus]);

  const pauseDailyTexts = async () => {
    if (!supabase || !session?.user) {
      setSmsStatusMessage("Sign in before pausing daily texts.");
      return;
    }

    setIsSmsStatusLoading(true);
    setSmsStatusMessage("");

    const response = await supabase
      .from("profiles")
      .update({ sms_enabled: false })
      .eq("id", session.user.id);

    setIsSmsStatusLoading(false);

    if (response.error) {
      setSmsStatusMessage(response.error.message);
      return;
    }

    setPreferences({ ...preferences, smsEnabled: false });
    setSmsStatusMessage("Daily texts paused.");
    await refreshSmsStatus();
  };

  const requestSmsCode = async () => {
    if (!session?.user) {
      setVerificationMessage("Sign in before verifying a phone number.");
      return;
    }

    if (!phoneFormatReady) {
      setVerificationMessage("Use E.164 format, like +14165550123.");
      return;
    }

    const headers = await authHeader();
    if (!headers) {
      setVerificationMessage("Sign in again before requesting a code.");
      return;
    }

    setIsSendingCode(true);
    setVerificationMessage("");

    try {
      const response = await fetch("/api/sms-verification/request", {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: phoneNumber })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not send verification code.");
      }

      setVerifiedPhone("");
      setSmsVerifiedAt("");
      setSmsConsentAt("");
      setSmsConsentAccepted(false);
      setPreferences({ ...preferences, smsEnabled: false });
      setVerificationMessage(
        payload.deliveryStatus === "dry_run"
          ? "Verification code recorded as a dry run because Twilio is not configured."
          : "Verification code sent."
      );
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Could not send verification code.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const verifySmsCode = async () => {
    if (!session?.user) {
      setVerificationMessage("Sign in before verifying a phone number.");
      return;
    }

    if (!smsConsentAccepted) {
      setVerificationMessage("Check the consent box before enabling daily texts.");
      return;
    }

    const headers = await authHeader();
    if (!headers) {
      setVerificationMessage("Sign in again before verifying the code.");
      return;
    }

    setIsVerifyingCode(true);
    setVerificationMessage("");

    try {
      const response = await fetch("/api/sms-verification/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: phoneNumber, code: verificationCode, consent: smsConsentAccepted })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not verify phone.");
      }

      setVerifiedPhone(payload.phone);
      setSmsVerifiedAt(payload.smsVerifiedAt);
      setSmsConsentAt(payload.smsConsentAt);
      setVerificationCode("");
      setPreferences({ ...preferences, smsEnabled: true });
      setVerificationMessage("Phone verified. Daily texts are enabled.");
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Could not verify phone.");
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const saveProfile = async () => {
    if (!supabase || !session?.user) {
      setAuthMessage("Sign in to save preferences to Supabase.");
      return false;
    }

    if (!phoneIsReady) {
      setAuthMessage("Verify your phone and consent to daily texts, or turn daily text off.");
      return false;
    }

    setIsSavingProfile(true);
    setAuthMessage("");

    const [profileResponse, preferenceResponse] = await Promise.all([
      supabase.from("profiles").upsert({
        id: session.user.id,
        display_name: session.user.email,
        location: preferences.location,
        latitude: preferences.latitude ?? null,
        longitude: preferences.longitude ?? null,
        location_accuracy_m: preferences.locationAccuracyM ?? null,
        location_source: preferences.locationSource ?? "manual",
        phone_e164: phoneNumber || null,
        sms_enabled: preferences.smsEnabled && phoneVerified && smsConsentReady,
        daily_send_time: preferences.sendTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto"
      }),
      supabase.from("preference_profiles").upsert({
        user_id: session.user.id,
        hobbies: preferences.hobbies,
        intensity: preferences.intensity,
        venue: preferences.venue,
        heat_sensitive: preferences.heatSensitive,
        sun_sensitive: preferences.sunSensitive,
        budget: preferences.budget,
        accessibility: preferences.accessibility,
        outfit_style: preferences.style
      })
    ]);

    setIsSavingProfile(false);

    if (profileResponse.error || preferenceResponse.error) {
      setAuthMessage(profileResponse.error?.message || preferenceResponse.error?.message || "Could not save preferences.");
      return false;
    }

    setSaved(true);
    setAuthMessage("Preferences saved to Supabase.");
    return true;
  };

  const saveRecommendation = async (result: RecommendationResult) => {
    if (!supabase || !session?.user) {
      return false;
    }

    const response = await supabase.from("daily_recommendations").insert({
      user_id: session.user.id,
      recommendation_date: new Date().toISOString().slice(0, 10),
      source: result.source,
      forecast_id: result.forecast.forecastId ?? null,
      model: result.source === "openai" ? "configured-openai-model" : null,
      recommendations: result.recommendations,
      outfit: result.outfit,
      sms_copy: result.smsCopy,
      guardrails_applied: result.guardrailsApplied
    });

    if (response.error) {
      setAuthMessage(response.error.message);
      return false;
    }

    setLastSavedPlanAt(new Date().toISOString());
    return true;
  };

  const generateDailyPlan = async () => {
    setIsGenerating(true);
    setGenerationError("");
    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences })
      });
      if (!response.ok) {
        throw new Error("Recommendation request failed");
      }
      const result = (await response.json()) as RecommendationResult;
      setRecommendationResult(result);
      setSelected(0);
      const profileSaved = await saveProfile();
      const planSaved = await saveRecommendation(result);
      if (profileSaved && planSaved) {
        setAuthMessage("Preferences and daily plan saved to Supabase.");
      }
    } catch {
      setGenerationError("Could not generate a fresh plan. Showing the local weather-safe ranking.");
      await saveProfile();
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>Sunwise</span>
        </div>
        <nav className="nav-list">
          <a className="nav-item active" href="#today">Today</a>
          <a className="nav-item" href="#activities">Activities</a>
          <a className="nav-item" href="#events">Events</a>
          <a className="nav-item" href="#wardrobe">Wardrobe</a>
          <a className="nav-item" href="#texts">Texts</a>
        </nav>
        <div className="digest-card">
          <Icon name="message" />
          <p>Morning digest</p>
          <strong>{preferences.smsEnabled ? `Send at ${formatSendTime(preferences.sendTime)}` : "Paused"}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="muted">{todayLabel}</p>
            <h1>Today in {displayLocation}</h1>
          </div>
          <div className="location-tools">
            <div className="location-control">
              <span aria-hidden="true">+</span>
              <input
                aria-label="Location"
                value={
                  preferences.locationSource === "browser" && preferences.location.startsWith("Current location (")
                    ? "Current location"
                    : preferences.location
                }
                onChange={(event) => {
                  setLocationMessage("");
                  updatePreferences({
                    ...preferences,
                    location: event.target.value,
                    latitude: null,
                    longitude: null,
                    locationAccuracyM: null,
                    locationSource: "manual"
                  });
                }}
              />
            </div>
            <button className="secondary-button location-button" type="button" onClick={useBrowserLocation} disabled={isLocating}>
              {isLocating ? "Locating..." : "Use my location"}
            </button>
            {locationMessage && <small className="field-hint location-message">{locationMessage}</small>}
            {preferences.locationSource === "browser" && (
              <small className="field-hint location-attribution">Location names © OpenStreetMap contributors</small>
            )}
          </div>
        </header>

        <div className="content-grid">
          <section className="main-column" id="today">
            <div className="weather-panel">
              <div className="weather-hero">
                <div>
                  <p className="muted">
                    {displayForecast.provider === "open-meteo" ? "Live Open-Meteo forecast" : "Preview forecast"}
                  </p>
                  <div className="temp-row">
                    <span>{displayForecast.temperatureC}C</span>
                    <Icon name="sun" />
                  </div>
                  <p>
                    {displayForecast.summary}. Feels like {displayForecast.feelsLikeC}. Best window: {displayForecast.bestWindow}.
                  </p>
                </div>
                <div className="weather-metrics">
                  <div>
                    <strong>UV {displayForecast.uvIndex}</strong>
                    <span>{displayForecast.uvIndex >= 7 ? "High" : displayForecast.uvIndex >= 4 ? "Moderate" : "Low"}</span>
                  </div>
                  <div>
                    <strong>Rain {displayForecast.rainChance}%</strong>
                    <span>{displayForecast.rainChance >= 50 ? "Likely" : "Chance"}</span>
                  </div>
                  <div>
                    <strong>{displayForecast.windKph} km/h</strong>
                    <span>Max wind</span>
                  </div>
                </div>
              </div>
              <div className="hourly-strip" aria-label="Hourly forecast">
                {displayHourly.map((hour) => (
                  <div className="hour-cell" key={hour.time}>
                    <span>{hour.time}</span>
                    <Icon name={hour.icon} />
                    <strong>{hour.temp} deg</strong>
                  </div>
                ))}
              </div>
            </div>

            <section className="recommendations" id="activities">
              <div className="section-title">
                <div>
                  <h2>Recommended for your summer</h2>
                  <p className="source-line">
                    {recommendationResult
                      ? `${recommendationResult.source === "openai" ? "AI-enhanced" : "Local"} plan generated`
                      : "Local weather-safe preview"}
                  </p>
                  {lastSavedPlanAt && <p className="saved-plan-line">Saved {new Date(lastSavedPlanAt).toLocaleString()}</p>}
                </div>
                <p>Ranked from hobbies, weather comfort, budget, and preferred intensity.</p>
              </div>
              <div className="activity-list">
                {rankedActivities.map((activity, index) => (
                  <button
                    className={`activity-card ${index === selected ? "selected" : ""}`}
                    key={activity.id}
                    onClick={() => setSelected(index)}
                  >
                    <span className="score">{activity.score}% fit</span>
                    <strong>{activity.title}</strong>
                    <span>{activity.time}</span>
                    <p>{activity.weatherReason || activity.forecast}</p>
                  </button>
                ))}
              </div>
            </section>

            {recommendationResult && (
              <section className="local-events" id="events">
                <div className="section-title">
                  <div>
                    <h2>Local events near you</h2>
                    <p className="source-line">Ticketmaster Discovery</p>
                  </div>
                  <p>Ranked by distance, interests, timing, price, and weather suitability.</p>
                </div>
                {recommendationResult.events.length ? (
                  <div className="event-list">
                    {recommendationResult.events.map((event) => (
                      <article className="event-card" key={event.id}>
                        <div className="event-card-top">
                          <span className="score">{event.score}% fit</span>
                          <span className={`status-pill ${event.weatherFit === "great" ? "good" : event.weatherFit === "caution" ? "warn" : "soft"}`}>
                            {event.weatherFit === "unknown" ? "Forecast pending" : `${event.weatherFit} weather`}
                          </span>
                        </div>
                        <h3>{event.title}</h3>
                        <p className="event-meta">
                          {formatEventDate(event)}
                          {event.venueName ? ` · ${event.venueName}` : ""}
                          {event.distanceKm !== null ? ` · ${event.distanceKm.toFixed(1)} km` : ""}
                        </p>
                        <p>{event.reason}</p>
                        <div className="event-card-footer">
                          <span>
                            {event.priceMin !== null
                              ? `From ${event.currency || ""} ${event.priceMin.toFixed(0)}`
                              : "Price unavailable"}
                          </span>
                          <a href={event.url} target="_blank" rel="noreferrer">
                            View event
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="event-empty">No Ticketmaster events were found nearby for the next seven days.</p>
                )}
              </section>
            )}

            <div className="detail-row">
              <section className="insight-panel">
                <h2>{topActivity.title}</h2>
                <p>{topActivity.aiReason ?? topActivity.reason}</p>
                <dl>
                  <div>
                    <dt>Best window</dt>
                    <dd>{topActivity.time}</dd>
                  </div>
                  <div>
                    <dt>Budget</dt>
                    <dd>${topActivity.cost} estimate</dd>
                  </div>
                  <div>
                    <dt>Weather fit</dt>
                    <dd>{topActivity.weatherScore ?? "Preview"}/30</dd>
                  </div>
                </dl>
                {topActivity.weatherReason && <p className="weather-reason">{topActivity.weatherReason}</p>}
                {topActivity.safetyNotes.length > 0 && (
                  <ul className="safety-list">
                    {topActivity.safetyNotes.slice(0, 2).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="outfit-panel" id="wardrobe">
                <div className="panel-heading">
                  <Icon name="shirt" />
                  <h2>Wear today</h2>
                </div>
                <p>Wear: {outfit}</p>
                {smsCopy && <p className="sms-preview">{smsCopy}</p>}
              </section>
            </div>
          </section>

          <aside className="preferences-panel" id="texts" aria-label="Preferences questionnaire">
            <section className="onboarding-panel" aria-label="Onboarding progress">
              <div className="panel-top">
                <div>
                  <p className="muted">Onboarding</p>
                  <h2>{onboardingDone}/5 ready</h2>
                </div>
                <span className="progress">{Math.round((onboardingDone / onboardingItems.length) * 100)}%</span>
              </div>
              <div className="onboarding-list">
                {onboardingItems.map((item) => (
                  <span className={item.done ? "done" : ""} key={item.label}>
                    {item.label}
                  </span>
                ))}
              </div>
            </section>

            <section className="auth-panel">
              <div>
                <p className="muted">Account</p>
                <h2>{session ? "Signed in" : "Save your summer profile"}</h2>
              </div>
              {session ? (
                <div className="signed-in-row">
                  <span>{session.user.email}</span>
                  <button type="button" onClick={signOut}>Sign out</button>
                </div>
              ) : (
                <>
                  <div className="segmented auth-mode">
                    <button
                      type="button"
                      className={authMode === "signup" ? "active" : ""}
                      onClick={() => setAuthMode("signup")}
                    >
                      Sign up
                    </button>
                    <button
                      type="button"
                      className={authMode === "signin" ? "active" : ""}
                      onClick={() => setAuthMode("signin")}
                    >
                      Sign in
                    </button>
                  </div>
                  <label className="field">
                    <span>Email</span>
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 6 characters"
                    />
                  </label>
                  <button className="secondary-button" type="button" onClick={handleAuth} disabled={!authCanSubmit}>
                    {isAuthLoading ? "Checking..." : authMode === "signup" ? "Create account" : "Sign in"}
                  </button>
                  {signupNeedsConfirmation && (
                    <button className="secondary-button" type="button" onClick={resendConfirmation}>
                      Resend confirmation
                    </button>
                  )}
                </>
              )}
              {!supabase && <p className="notice-text">Supabase auth is waiting for the anon key in .env.local.</p>}
              {authMessage && <p className="notice-text">{authMessage}</p>}
            </section>

            <div className="panel-top">
              <div>
                <p className="muted">Questionnaire</p>
                <h2>Preferences</h2>
              </div>
              <span className="progress">7/9</span>
            </div>

            <label className="toggle-row">
              <span>
                <strong>Daily text</strong>
                <small>{preferences.smsEnabled ? `Send at ${formatSendTime(preferences.sendTime)}` : "Off"}</small>
              </span>
              <input
                type="checkbox"
                checked={preferences.smsEnabled}
                onChange={(event) => {
                  if (event.target.checked && !smsConsentReady) {
                    setVerificationMessage("Verify your phone and consent before enabling daily texts.");
                    return;
                  }
                  updatePreferences({ ...preferences, smsEnabled: event.target.checked });
                }}
              />
            </label>

            <label className="field">
              <span>Phone number</span>
              <input
                value={phoneNumber}
                onChange={(event) => {
                  setPhoneNumber(event.target.value);
                  setVerifiedPhone("");
                  setSmsVerifiedAt("");
                  setSmsConsentAt("");
                  setSmsConsentAccepted(false);
                  setVerificationCode("");
                  setVerificationMessage("");
                  updatePreferences({ ...preferences, smsEnabled: false });
                  setSaved(false);
                }}
                placeholder="+14165550123"
              />
              <small className="field-hint">
                {!phoneFormatReady && phoneNumber
                  ? "Use E.164 format, including country code."
                  : phoneVerified
                    ? "Verified for daily Sunwise texts."
                    : "Used only for daily texts."}
              </small>
            </label>

            <section className="sms-verification-panel">
              <div className="admin-stats">
                <span className={phoneVerified ? "status-pill good" : "status-pill soft"}>
                  {phoneVerified ? "Phone verified" : "Verification needed"}
                </span>
                <span className={smsConsentReady ? "status-pill good" : "status-pill soft"}>
                  {smsConsentReady ? "Consent recorded" : "Consent needed"}
                </span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={requestSmsCode}
                disabled={!session || !phoneFormatReady || isSendingCode}
              >
                {isSendingCode ? "Sending..." : phoneVerified ? "Send new code" : "Send verification code"}
              </button>
              <label className="check-consent">
                <input
                  type="checkbox"
                  checked={smsConsentAccepted}
                  onChange={(event) => setSmsConsentAccepted(event.target.checked)}
                />
                <span>{SMS_CONSENT_TEXT}</span>
              </label>
              <div className="verify-code-row">
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={verifySmsCode}
                  disabled={!session || verificationCode.length !== 6 || !smsConsentAccepted || isVerifyingCode}
                >
                  {isVerifyingCode ? "Verifying..." : "Verify"}
                </button>
              </div>
              {verificationMessage && <p className="notice-text">{verificationMessage}</p>}
            </section>

            <section className="sms-status-panel" aria-label="Daily text status">
              <div className="panel-top">
                <div>
                  <p className="muted">Text status</p>
                  <h2>{smsStatus?.eligible ? "Ready for delivery" : preferences.smsEnabled ? "Needs attention" : "Paused"}</h2>
                </div>
                <span className={`status-pill ${smsStatus?.eligible ? "good" : smsStatus?.optedOut ? "bad" : "soft"}`}>
                  {smsStatus?.optedOut ? "Opted out" : smsStatus?.enabled ? "On" : "Off"}
                </span>
              </div>
              <div className="sms-status-grid">
                <div>
                  <span>Phone</span>
                  <strong>{smsStatus?.phone || phoneNumber || "Not set"}</strong>
                </div>
                <div>
                  <span>Verified</span>
                  <strong>{smsStatus?.verified ? "Yes" : "No"}</strong>
                </div>
                <div>
                  <span>Consent</span>
                  <strong>{smsStatus?.consented ? "Recorded" : "Missing"}</strong>
                </div>
                <div>
                  <span>Next send</span>
                  <strong>
                    {smsStatus?.nextSend ? `${smsStatus.nextSend.date} at ${formatSendTime(smsStatus.nextSend.time)}` : "Not scheduled"}
                  </strong>
                </div>
              </div>
              <div className="sms-status-list">
                <div>
                  <span>Last SMS</span>
                  <strong className={`status-pill ${smsStatusTone(smsStatus?.latestDelivery?.status)}`}>
                    {smsStatus?.latestDelivery?.status || "none"}
                  </strong>
                  <small>{formatStatusDate(smsStatus?.latestDelivery?.updated_at)}</small>
                </div>
                <div>
                  <span>Last digest run</span>
                  <strong className={`status-pill ${smsStatusTone(smsStatus?.latestRun?.status)}`}>
                    {smsStatus?.latestRun?.status || "none"}
                  </strong>
                  <small>
                    {smsStatus?.latestRun
                      ? `${formatStatusDate(smsStatus.latestRun.started_at)}: ${smsStatus.latestRun.sent} sent, ${smsStatus.latestRun.failed} failed`
                      : "Not yet"}
                  </small>
                </div>
              </div>
              <div className="sms-status-actions">
                <button className="secondary-button" type="button" onClick={refreshSmsStatus} disabled={!session || isSmsStatusLoading}>
                  {isSmsStatusLoading ? "Refreshing..." : "Refresh status"}
                </button>
                <button className="secondary-button" type="button" onClick={pauseDailyTexts} disabled={!session || !smsStatus?.enabled || isSmsStatusLoading}>
                  Pause texts
                </button>
              </div>
              {smsStatusMessage && <p className="notice-text">{smsStatusMessage}</p>}
            </section>

            <label className="field">
              <span>Text time</span>
              <input
                type="time"
                value={preferences.sendTime}
                onChange={(event) => updatePreferences({ ...preferences, sendTime: event.target.value })}
              />
            </label>

            <fieldset>
              <legend>Summer hobbies</legend>
              <div className="chip-grid">
                {hobbyOptions.map((hobby) => (
                  <button
                    type="button"
                    className={preferences.hobbies.includes(hobby) ? "chip active" : "chip"}
                    key={hobby}
                    onClick={() => toggleHobby(hobby)}
                  >
                    {hobby}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Activity intensity</legend>
              <div className="segmented">
                {(["Easy", "Balanced", "Active"] as Intensity[]).map((item) => (
                  <button
                    type="button"
                    className={preferences.intensity === item ? "active" : ""}
                    key={item}
                    onClick={() => updatePreferences({ ...preferences, intensity: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Venue preference</legend>
              <div className="segmented">
                {(["Outdoor", "Mixed", "Indoor"] as Venue[]).map((item) => (
                  <button
                    type="button"
                    className={preferences.venue === item ? "active" : ""}
                    key={item}
                    onClick={() => updatePreferences({ ...preferences, venue: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="check-grid">
              <label>
                <input
                  type="checkbox"
                  checked={preferences.heatSensitive}
                  onChange={(event) => updatePreferences({ ...preferences, heatSensitive: event.target.checked })}
                />
                Heat sensitive
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.sunSensitive}
                  onChange={(event) => updatePreferences({ ...preferences, sunSensitive: event.target.checked })}
                />
                Sun sensitive
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.accessibility}
                  onChange={(event) => updatePreferences({ ...preferences, accessibility: event.target.checked })}
                />
                Step-free ideas
              </label>
            </div>

            <label className="field">
              <span>Daily budget: ${preferences.budget}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={preferences.budget}
                onChange={(event) => updatePreferences({ ...preferences, budget: Number(event.target.value) })}
              />
            </label>

            <fieldset>
              <legend>Outfit style</legend>
              <div className="segmented">
                {(["Breezy", "Sporty", "Polished"] as Style[]).map((item) => (
                  <button
                    type="button"
                    className={preferences.style === item ? "active" : ""}
                    key={item}
                    onClick={() => updatePreferences({ ...preferences, style: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>

            {generationError && <p className="error-text">{generationError}</p>}
            <button className="save-button" onClick={generateDailyPlan} disabled={isGenerating || isSavingProfile || !phoneIsReady}>
              {isGenerating || isSavingProfile ? (
                "Saving..."
              ) : saved ? (
                <>
                  <Icon name="check" /> Saved
                </>
              ) : (
                "Save preferences"
              )}
            </button>
          </aside>
        </div>
      </section>
    </main>
  );
}
