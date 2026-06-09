<?php
session_start();

// ── Config (edit config.json — never committed to git) ───────────────────────
$_cfg = json_decode(file_get_contents(__DIR__ . '/config.json'), true);
define('SITE_PASSWORD',    $_cfg['SITE_PASSWORD']);   // set to '' to disable password protection
define('CESIUM_TOKEN',     $_cfg['CESIUM_TOKEN']);
define('MAPTILER_KEY',     $_cfg['MAPTILER_KEY']);
define('BW_CLIENT_ID',     $_cfg['BW_CLIENT_ID']);
define('BW_CLIENT_SECRET', $_cfg['BW_CLIENT_SECRET']);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['a'] ?? '';

// ── Login (always accessible, no auth needed) ────────────────────────────────
if ($action === 'login' || ($action === '' && $method === 'POST' && isset($_POST['password']))) {
    if ($method === 'POST') {
        $pw = trim($_POST['password'] ?? '');
        if (SITE_PASSWORD !== '' && $pw === SITE_PASSWORD) {
            $_SESSION['geobed3d_auth'] = true;
            header('Location: ./');
            exit;
        }
        serve_password_page('Incorrect password.');
    } else {
        serve_password_page('');
    }
    exit;
}

// ── Auth gate ────────────────────────────────────────────────────────────────
if (SITE_PASSWORD !== '' && empty($_SESSION['geobed3d_auth'])) {
    serve_password_page('');
    exit;
}

// ── Authenticated routes (all go to proxy.php?a=...) ────────────────────────

if ($action === 'ais-token') {
    if (!function_exists('curl_init')) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl not available on this server']);
        exit;
    }
    $body = http_build_query([
        'grant_type'    => 'client_credentials',
        'client_id'     => BW_CLIENT_ID,
        'client_secret' => BW_CLIENT_SECRET,
        'scope'         => 'ais',
    ]);
    $ch = curl_init('https://id.barentswatch.no/connect/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $data = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($data === false) {
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl failed: ' . $err]);
        exit;
    }
    http_response_code($code);
    header('Content-Type: application/json');
    echo $data;
    exit;
}

if ($action === 'ais-data') {
    $token = $_GET['token'] ?? '';
    if (!$token) { http_response_code(400); exit('Missing token'); }
    curl_forward(
        'https://live.ais.barentswatch.no/live/v1/latest/combined',
        ['Authorization: Bearer ' . $token]
    );
}

if ($action === 'img') {
    $url = $_GET['url'] ?? '';
    if (!$url) { http_response_code(400); exit('Missing url'); }
    curl_forward($url, ['User-Agent: Mozilla/5.0 (compatible; GeoBed3D/1.0)'], true);
}

// ── No action = serve index.html with injected config ───────────────────────
serve_static();


// ── Helpers ───────────────────────────────────────────────────────────────────

function curl_forward($url, $headers = [], $cache = false) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HEADER         => true,
    ]);
    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ct       = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $hsize    = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $body = substr($response, $hsize);
    http_response_code($code);
    header('Content-Type: ' . ($ct ?: 'application/octet-stream'));
    if ($cache) header('Cache-Control: public, max-age=86400');
    echo $body;
    exit;
}

function serve_static() {
    $file = realpath(__DIR__ . '/index.html');
    if (!$file || !is_file($file)) { http_response_code(404); exit('Not found'); }
    $config  = json_encode(['cesiumToken' => CESIUM_TOKEN, 'maptilerKey' => MAPTILER_KEY]);
    $inject  = "<script>window.__GEOBED3D_CONFIG__={$config};</script>";
    $content = file_get_contents($file);
    header('Content-Type: text/html; charset=utf-8');
    echo str_replace('</head>', $inject . '</head>', $content);
    exit;
}

function serve_password_page($error) {
    $err = htmlspecialchars($error, ENT_QUOTES, 'UTF-8');
    header('Content-Type: text/html; charset=utf-8');
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GeoBed3D — Access</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #080d18; font-family: 'Inter', system-ui, sans-serif; color: #e2e8f0;
    }
    .card {
      background: #0b1120; border: 1px solid #1a2840; border-radius: 14px;
      padding: 2.5rem 2rem; width: 340px; text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,.6);
    }
    .logo { font-size: 2rem; font-weight: 700; letter-spacing: -1px; margin-bottom: .5rem; }
    .logo span { color: #3b82f6; }
    .subtitle { color: #94a3b8; font-size: .85rem; margin-bottom: 2rem; }
    input[type=password] {
      width: 100%; padding: .65rem 1rem; border-radius: 8px;
      background: #0f1a2e; border: 1px solid #1a2840; color: #e2e8f0;
      font-size: .95rem; font-family: inherit; outline: none; transition: border-color .15s;
    }
    input[type=password]:focus { border-color: #3b82f6; }
    button {
      margin-top: .75rem; width: 100%; padding: .65rem; border-radius: 8px;
      background: #3b82f6; border: none; color: #fff; font-size: .95rem;
      font-family: inherit; font-weight: 600; cursor: pointer; transition: background .15s;
    }
    button:hover { background: #2563eb; }
    .err { color: #ef4444; font-size: .82rem; margin-top: .6rem; min-height: 1.1em; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">GeoBed<span>3D</span></div>
    <div class="subtitle">Enter password to access the viewer</div>
    <form method="POST" action="proxy.php">
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Enter</button>
      <div class="err">{$err}</div>
    </form>
  </div>
</body>
</html>
HTML;
    exit;
}
