<?php
/**
 * Extend Book Endpoint
 *
 * Handles POST /api/v1/nextlib/extend-book requests.
 * Executes loan extension in the SLiMS database.
 *
 * Request:  { "loan_id": string, "days": int }
 * Response: { "success": bool, "new_due_date": string }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class ExtendBook
{
    /** @var \PDO|null Database connection (injectable for testing) */
    private $db;

    /**
     * @param \PDO|null $db Optional PDO connection. If null, uses SLiMS global $dbs.
     */
    public function __construct($db = null)
    {
        $this->db = $db;
    }

    /**
     * Handle the extend book request.
     *
     * Looks up the loan by loan_id, validates it is still active,
     * and extends the due_date by the specified number of days.
     *
     * @param array $params Parsed request parameters:
     *   - loan_id (string): The loan ID to extend
     *   - days (int): Number of days to extend (1-30)
     * @return array Response data with success status and new due date
     */
    public function handle(array $params): array
    {
        $loanId = isset($params['loan_id']) ? trim((string) $params['loan_id']) : '';
        $days = isset($params['days']) ? (int) $params['days'] : 0;

        // Validate loan_id parameter
        if ($loanId === '') {
            return array(
                'error' => true,
                'code' => 'INVALID_PARAMS',
                'message' => 'Parameter loan_id is required',
            );
        }

        // Validate days parameter
        if ($days < 1) {
            return array(
                'error' => true,
                'code' => 'INVALID_PARAMS',
                'message' => 'Parameter days must be at least 1',
            );
        }

        if ($days > 30) {
            return array(
                'error' => true,
                'code' => 'INVALID_PARAMS',
                'message' => 'Parameter days must not exceed 30',
            );
        }

        $db = $this->getConnection();
        if ($db === null) {
            return array(
                'error' => true,
                'code' => 'DB_CONNECTION_FAILED',
                'message' => 'Database connection is not available',
            );
        }

        // Query the loan record
        $loanSql = "SELECT loan_id, member_id, item_code, due_date, is_lent, is_return FROM loan WHERE loan_id = :loan_id";
        $loanStmt = $db->prepare($loanSql);
        $loanStmt->bindValue(':loan_id', $loanId, \PDO::PARAM_STR);
        $loanStmt->execute();
        $loan = $loanStmt->fetch(\PDO::FETCH_ASSOC);

        if ($loan === false) {
            return array(
                'error' => true,
                'code' => 'LOAN_NOT_FOUND',
                'message' => 'Loan record not found',
            );
        }

        // Check if the loan is still active (not yet returned)
        if (isset($loan['is_return']) && (int) $loan['is_return'] === 1) {
            return array(
                'error' => true,
                'code' => 'LOAN_ALREADY_RETURNED',
                'message' => 'Cannot extend a loan that has already been returned',
            );
        }

        // Calculate new due date
        $currentDueDate = isset($loan['due_date']) ? $loan['due_date'] : date('Y-m-d');
        $newDueDate = date('Y-m-d', strtotime($currentDueDate . ' + ' . $days . ' days'));

        // Update the due_date in the database
        $updateSql = "UPDATE loan SET due_date = :new_due_date WHERE loan_id = :loan_id";
        $updateStmt = $db->prepare($updateSql);
        $updateStmt->bindValue(':new_due_date', $newDueDate, \PDO::PARAM_STR);
        $updateStmt->bindValue(':loan_id', $loanId, \PDO::PARAM_STR);
        $success = $updateStmt->execute();

        if (!$success) {
            return array(
                'error' => true,
                'code' => 'UPDATE_FAILED',
                'message' => 'Failed to update loan due date',
            );
        }

        return array(
            'success' => true,
            'new_due_date' => $newDueDate,
        );
    }

    /**
     * Get the database connection.
     *
     * Uses the injected PDO instance if available, otherwise
     * falls back to the SLiMS global $dbs connection.
     *
     * @return \PDO|null
     */
    private function getConnection()
    {
        if ($this->db !== null) {
            return $this->db;
        }

        // SLiMS uses a global $dbs variable for the database connection
        global $dbs;
        if (isset($dbs) && $dbs instanceof \PDO) {
            return $dbs;
        }

        return null;
    }
}
