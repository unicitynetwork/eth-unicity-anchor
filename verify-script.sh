#!/bin/bash
# Simple verification that the manual-e2e-test.sh returns correct exit codes

echo "Running successful test (should return 0)..."
./scripts/manual-e2e-test.sh
SUCCESS_EXIT_CODE=$?
echo "Exit code from successful test: $SUCCESS_EXIT_CODE"

# Now break the test
echo "Breaking test..."
sed -i 's/expect(successCount).toBe(BigInt(count));/expect(successCount).toBe(BigInt(count * 2)); \/\/ INTENTIONALLY BROKEN/' ts-client/tests/integration/e2e.test.ts

echo "Running failing test (should return non-zero)..."
./scripts/manual-e2e-test.sh
FAIL_EXIT_CODE=$?
echo "Exit code from failing test: $FAIL_EXIT_CODE"

# Fix test
echo "Restoring test..."
sed -i 's/expect(successCount).toBe(BigInt(count \* 2)); \/\/ INTENTIONALLY BROKEN/expect(successCount).toBe(BigInt(count));/' ts-client/tests/integration/e2e.test.ts

echo "Verification complete."
echo "Success test exit code: $SUCCESS_EXIT_CODE"
echo "Failure test exit code: $FAIL_EXIT_CODE"

if [ $SUCCESS_EXIT_CODE -eq 0 ] && [ $FAIL_EXIT_CODE -ne 0 ]; then
  echo "✅ Test script correctly returns proper exit codes"
else
  echo "❌ Test script is not returning correct exit codes"
fi