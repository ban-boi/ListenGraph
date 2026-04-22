$ErrorActionPreference = 'Stop'

$encoder = 'D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\encoder.int8.onnx'
$decoder = 'D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\decoder.int8.onnx'
$tokens = 'D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\tokens.txt'

$modelName = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en'
$host = '127.0.0.1'
$port = 15377
$protocolPath = '/ws'
$numThreads = 4
$rule1Silence = 1.5
$rule2Silence = 0.8
$rule3MaxUtterance = 20.0
$provider = 'cpu'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDir 'sherpa-onnx-bridge.py'

$arguments = @(
  $bridgeScript
  '--host', $host
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

& python @arguments
