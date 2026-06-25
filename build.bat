@echo off
chcp 949 >nul
rem 칸반 보드를 단일 release\index.html 파일로 빌드합니다.
rem 필요 도구: node + tsc (TypeScript). 런타임 외부 의존성은 없습니다.

cd /d "%~dp0"

echo [1/2] 타입스크립트 컴파일 중...
call npx tsc
if errorlevel 1 goto :error

echo [2/2] 단일 index.html 로 번들링 중...
node tools\bundle.mjs
if errorlevel 1 goto :error

echo 빌드 완료: release\index.html
echo 실행 방법: cd release ^&^& python -m http.server 8001
goto :eof

:error
echo 빌드 실패
exit /b 1
