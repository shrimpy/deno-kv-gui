use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDraft {
    pub name: String,
    pub database_id: String,
    pub url: String,
    pub url_shape: String,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeployList {
    pub available: bool,
    pub databases: Vec<DatabaseDraft>,
    pub message: String,
}

pub fn environment_from_database_name(name: &str) -> Option<&'static str> {
    let trimmed = name.trim();
    if let Some(marker) = trimmed.find("--") {
        if marker > 0 && marker < trimmed.len() - 2 {
            return Some("branch");
        }
    }
    if trimmed.ends_with("-production") {
        return Some("production");
    }
    if trimmed.ends_with("-preview") {
        return Some("preview");
    }
    None
}

fn url_shape(url: &str) -> &'static str {
    if url.contains("/v2/databases/") {
        "v2"
    } else if url.contains("/databases/") {
        "classic"
    } else {
        "custom"
    }
}

fn connect_url(id: &str, shape: &str) -> String {
    match shape {
        "classic" => format!("https://api.deno.com/databases/{id}/connect"),
        _ => format!("https://api.deno.com/v2/databases/{id}/connect"),
    }
}

pub fn drafts_from_value(value: &Value) -> Vec<DatabaseDraft> {
    let mut drafts = Vec::new();
    walk(value, &mut drafts);
    drafts
}

fn walk(value: &Value, drafts: &mut Vec<DatabaseDraft>) {
    match value {
        Value::Array(items) => {
            for item in items {
                walk(item, drafts);
            }
        }
        Value::Object(map) => {
            if let Some(draft) = draft_from_object(map) {
                if !drafts.iter().any(|existing| existing.database_id == draft.database_id) {
                    drafts.push(draft);
                }
            }
            for child in map.values() {
                walk(child, drafts);
            }
        }
        _ => {}
    }
}

fn draft_from_object(map: &serde_json::Map<String, Value>) -> Option<DatabaseDraft> {
    let database_id = map
        .get("databaseId")
        .or_else(|| map.get("database_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())?
        .to_string();
    let name = map
        .get("name")
        .or_else(|| map.get("description"))
        .or_else(|| map.get("slug"))
        .and_then(Value::as_str)
        .unwrap_or(&database_id)
        .trim()
        .to_string();
    let explicit = map
        .get("kvConnect")
        .or_else(|| map.get("kv_connect"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string);
    let (url, url_shape) = if let Some(url) = explicit {
        let shape = url_shape(&url).to_string();
        (url, shape)
    } else {
        (connect_url(&database_id, "v2"), "v2".to_string())
    };
    let environment = environment_from_database_name(&name)
        .unwrap_or("self-hosted")
        .to_string();
    Some(DatabaseDraft {
        name,
        database_id,
        url,
        url_shape,
        environment,
    })
}

pub async fn list_databases(token: &str) -> Result<DeployList, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("access token is required".into());
    }
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.deno.com/v2/apps")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "could not reach the Deno Deploy API".to_string())?;
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err("Deploy API rejected the access token".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Deploy API returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "Deploy API returned invalid JSON".to_string())?;
    let databases = drafts_from_value(&body);
    if databases.is_empty() {
        return Ok(DeployList {
            available: false,
            databases,
            message: "The published Deno Deploy v2 API does not list KV database ids. Paste the id from the Databases table in the Deno Deploy console.".into(),
        });
    }
    Ok(DeployList {
        available: true,
        databases,
        message: "Databases returned by the Deploy API.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_timeline_names() {
        assert_eq!(
            environment_from_database_name("myapp-production"),
            Some("production")
        );
        assert_eq!(
            environment_from_database_name("my-app-preview"),
            Some("preview")
        );
        assert_eq!(
            environment_from_database_name("myapp--main"),
            Some("branch")
        );
        assert_eq!(
            environment_from_database_name("myapp--feature-production"),
            Some("branch")
        );
        assert_eq!(environment_from_database_name("myapp"), None);
    }

    #[test]
    fn extracts_database_drafts_and_ignores_app_lists() {
        let classic = json!([{
            "databaseId": "11111111-1111-1111-1111-111111111111",
            "description": "myapp-production",
            "kvConnect": "https://api.deno.com/databases/11111111-1111-1111-1111-111111111111/connect"
        }]);
        let drafts = drafts_from_value(&classic);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].environment, "production");
        assert_eq!(drafts[0].url_shape, "classic");

        let branch = json!({
            "databaseId": "22222222-2222-2222-2222-222222222222",
            "name": "myapp--dev",
            "kvConnect": "https://api.deno.com/v2/databases/22222222-2222-2222-2222-222222222222/connect"
        });
        let drafts = drafts_from_value(&branch);
        assert_eq!(drafts[0].environment, "branch");
        assert_eq!(drafts[0].url_shape, "v2");

        let apps = json!([{
            "id": "not-a-database",
            "slug": "myapp",
            "layers": [],
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z"
        }]);
        assert!(drafts_from_value(&apps).is_empty());
    }
}
