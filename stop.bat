@echo off
REM =============================================================================
REM DESeq2 Explorer — Stop (Windows)
REM =============================================================================
echo Stopping DESeq2 Explorer...
docker compose -f docker-compose.desktop.yml down
echo.
echo Done. Your data is preserved in the 'deseq2_data' Docker volume.
echo.
pause
