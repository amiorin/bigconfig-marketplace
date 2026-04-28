/// <reference path="../pb_data/types.d.ts" />

// Initial schema for the `packages` collection.
// Targets PocketBase v0.22.x.

migrate(
  (db) => {
    const dao = new Dao(db);

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
      id: "pkg_packages_001",
      name: "packages",
      type: "base",
      schema: [
        {
          name: "github_url",
          type: "url",
          required: true,
          options: {
            exceptDomains: null,
            onlyDomains: ["github.com"],
          },
        },
        {
          name: "name",
          type: "text",
          required: true,
          options: { min: 3, max: 200 },
        },
        {
          name: "description",
          type: "text",
          required: false,
          options: { max: 500 },
        },
        {
          name: "tags",
          type: "select",
          required: false,
          options: { maxSelect: 10, values: tags },
        },
        {
          name: "submitter",
          type: "relation",
          required: true,
          options: {
            collectionId: "_pb_users_auth_",
            cascadeDelete: false,
            maxSelect: 1,
            displayFields: ["name", "email"],
          },
        },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["pending", "approved", "rejected"],
          },
        },
        {
          name: "stars",
          type: "number",
          required: false,
          options: { min: 0 },
        },
        {
          name: "default_branch",
          type: "text",
          required: false,
          options: { max: 100 },
        },
        {
          name: "pushed_at",
          type: "date",
          required: false,
          options: {},
        },
        {
          name: "og_image",
          type: "url",
          required: false,
          options: {},
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_packages_github_url` ON `packages` (`github_url`)",
        "CREATE UNIQUE INDEX `idx_packages_name` ON `packages` (`name`)",
        "CREATE INDEX `idx_packages_status` ON `packages` (`status`)",
      ],
      // List/view: approved rows are public; submitter sees own pending/rejected.
      listRule:
        'status = "approved" || (@request.auth.id != "" && submitter = @request.auth.id)',
      viewRule:
        'status = "approved" || (@request.auth.id != "" && submitter = @request.auth.id)',
      // Anyone signed in can create. Hook forces status=pending and submitter=auth.
      createRule: '@request.auth.id != ""',
      // Submitters edit their own rows; hook strips protected fields.
      updateRule: "@request.auth.id != \"\" && submitter = @request.auth.id",
      // Delete: own rows. Admins can always delete via admin UI.
      deleteRule: "@request.auth.id != \"\" && submitter = @request.auth.id",
    });

    return dao.saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("packages");
    return dao.deleteCollection(collection);
  }
);
