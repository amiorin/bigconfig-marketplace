/// <reference path="../pb_data/types.d.ts" />

// Configure the Google OAuth2 provider on `_pb_users_auth_` from
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on every bootstrap, so
// rotating the secret only requires a container restart.

onBootstrap((e) => {
  e.next();

  const clientId = $os.getenv("GOOGLE_CLIENT_ID");
  const clientSecret = $os.getenv("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.log("[google_oauth] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set; skipping Google OAuth2 provider config");
    return;
  }

  const collection = e.app.findCollectionByNameOrId("_pb_users_auth_");

  unmarshal({
    oauth2: {
      enabled: true,
      providers: [
        {
          name: "google",
          clientId: clientId,
          clientSecret: clientSecret,
        },
      ],
    },
  }, collection);

  e.app.save(collection);
});
