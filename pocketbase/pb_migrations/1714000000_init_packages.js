/// <reference path="../pb_data/types.d.ts" />

// Initial schema for the `packages` collection.
// Targets PocketBase v0.23+ (tested on v0.37.4).

migrate(
  (app) => {
    const tags = [
      // providers
      "digitalocean",
      "hcloud",
      "oci",
      "no-infra",
      "cloudflare",
      "resend",
      "s3",
      // tools
      "opentofu",
      "ansible",
      "docker",
      // category
      "database",
      "cache",
      "streaming",
      "observability",
      "dev-env",
      "webapp",
      "static-site",
      "email",
      "dns",
      "apps",
      // license
      "open-source",
      "source-available",
    ];

    const collection = new Collection({
      type: "base",
      name: "packages",
      listRule:
        "status = 'approved' || (@request.auth.id != '' && submitter = @request.auth.id)",
      viewRule:
        "status = 'approved' || (@request.auth.id != '' && submitter = @request.auth.id)",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && submitter = @request.auth.id",
      deleteRule: "@request.auth.id != '' && submitter = @request.auth.id",
      fields: [
        {
          type: "text",
          name: "id",
          primaryKey: true,
          required: true,
          system: true,
          autogeneratePattern: "[a-z0-9]{15}",
          pattern: "^[a-z0-9]+$",
          min: 15,
          max: 15,
        },
        {
          type: "url",
          name: "github_url",
          required: true,
          onlyDomains: ["github.com"],
        },
        {
          type: "text",
          name: "name",
          required: true,
          min: 3,
          max: 200,
        },
        {
          type: "text",
          name: "description",
          required: false,
          max: 500,
        },
        {
          type: "select",
          name: "tags",
          required: false,
          maxSelect: 10,
          values: tags,
        },
        {
          type: "relation",
          name: "submitter",
          required: true,
          collectionId: "_pb_users_auth_",
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["pending", "approved", "rejected"],
        },
        {
          type: "number",
          name: "stars",
          required: false,
          min: 0,
        },
        {
          type: "text",
          name: "default_branch",
          required: false,
          max: 100,
        },
        {
          type: "date",
          name: "pushed_at",
          required: false,
        },
        {
          type: "url",
          name: "og_image",
          required: false,
        },
        {
          type: "autodate",
          name: "created",
          onCreate: true,
          onUpdate: false,
        },
        {
          type: "autodate",
          name: "updated",
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_packages_github_url` ON `packages` (`github_url`)",
        "CREATE UNIQUE INDEX `idx_packages_name` ON `packages` (`name`)",
        "CREATE INDEX `idx_packages_status` ON `packages` (`status`)",
      ],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("packages");
    return app.delete(collection);
  }
);
