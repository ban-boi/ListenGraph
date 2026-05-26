$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$modelDir = Join-Path $repoRoot '.tmp\sherpa-model\sherpa-onnx-streaming-paraformer-bilingual-zh-en'

# Copy this file or edit it in place for your own machine.
# Only these three paths usually need to be changed.
$encoder = Join-Path $modelDir 'encoder.int8.onnx'
$decoder = Join-Path $modelDir 'decoder.int8.onnx'
$tokens = Join-Path $modelDir 'tokens.txt'

$modelName = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en'
$bindHost = '127.0.0.1'
$port = 15377
$protocolPath = '/ws'
$numThreads = 4
$rule1Silence = 1.5
$rule2Silence = 0.8
$rule3MaxUtterance = 20.0
$provider = 'cpu'
# $authToken = 'my-local-token'

$bridgeScript = Join-Path $repoRoot 'tools\sherpa-onnx-bridge.py'

$arguments = @(
  $bridgeScript
  '--host', $bindHost
  '--port', "$port"
  '--path', $protocolPath
  '--encoder', $encoder
  '--decoder', $decoder
  '--tokens', $tokens
  '--model-name', $modelName
  '--provider', $provider
  '--num-threads', "$numThreads"
  '--rule1-silence', "$rule1Silence"
  '--rule2-silence', "$rule2Silence"
  '--rule3-max-utterance', "$rule3MaxUtterance"
)

if ($authToken) {
  $arguments += @('--auth-token', $authToken)
}

Write-Host "[sherpa-reference-bridge] repoRoot=$repoRoot"
Write-Host "[sherpa-reference-bridge] encoder=$encoder"
Write-Host "[sherpa-reference-bridge] decoder=$decoder"
Write-Host "[sherpa-reference-bridge] tokens=$tokens"

& python @arguments
