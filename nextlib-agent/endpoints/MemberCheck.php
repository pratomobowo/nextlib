<?php
/**
 * Member Check Endpoint
 *
 * Handles POST /api/v1/nextlib/member-check requests.
 * Queries member status and active fines from SLiMS database.
 *
 * Request:  { "member_id": string }
 * Response: { "status": string, "fines": Fine[] }
 *
 * @package    NextLib-Agent
 * @subpackage Endpoints
 * @version    1.0.0
 * @requires   PHP 7.4+
 */

namespace NextLibAgent\endpoints;

class MemberCheck
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
     * Handle the member check request.
     *
     * Looks up a member by member_id, determines their status
     * (active/expired/pending), and queries active fines.
     *
     * @param array $params Parsed request parameters:
     *   - member_id (string): The member ID to look up
     * @return array Response data with member status and fines
     */
    public function handle(array $params): array
    {
        $memberId = isset($params['member_id']) ? trim((string) $params['member_id']) : '';

        // Validate member_id parameter
        if ($memberId === '') {
            return array(
                'error' => true,
                'code' => 'INVALID_PARAMS',
                'message' => 'Parameter member_id is required',
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

        // Query member table for status
        $memberSql = "SELECT member_id, member_name, expire_date, is_pending FROM member WHERE member_id = :member_id";
        $memberStmt = $db->prepare($memberSql);
        $memberStmt->bindValue(':member_id', $memberId, \PDO::PARAM_STR);
        $memberStmt->execute();
        $member = $memberStmt->fetch(\PDO::FETCH_ASSOC);

        if ($member === false) {
            return array(
                'error' => true,
                'code' => 'MEMBER_NOT_FOUND',
                'message' => 'Member not found',
            );
        }

        // Determine member status
        $status = $this->determineMemberStatus($member);

        // Query active fines (where debet > credit)
        $finesSql = "SELECT fines_id, debet, credit, description, fines_date FROM fines WHERE member_id = :member_id AND debet > credit";
        $finesStmt = $db->prepare($finesSql);
        $finesStmt->bindValue(':member_id', $memberId, \PDO::PARAM_STR);
        $finesStmt->execute();
        $finesRows = $finesStmt->fetchAll(\PDO::FETCH_ASSOC);

        // Map fines to response format
        $fines = array();
        foreach ($finesRows as $row) {
            $fines[] = array(
                'id' => (int) $row['fines_id'],
                'amount' => (float) $row['debet'] - (float) $row['credit'],
                'description' => (string) $row['description'],
                'date' => (string) $row['fines_date'],
            );
        }

        return array(
            'status' => $status,
            'fines' => $fines,
        );
    }

    /**
     * Determine member status based on expire_date and is_pending fields.
     *
     * @param array $member Member record from database
     * @return string Status: 'active', 'expired', or 'pending'
     */
    private function determineMemberStatus(array $member): string
    {
        // Check if member is pending
        if (isset($member['is_pending']) && (int) $member['is_pending'] === 1) {
            return 'pending';
        }

        // Check expiry date
        if (isset($member['expire_date']) && $member['expire_date'] !== null && $member['expire_date'] !== '') {
            $expireDate = strtotime($member['expire_date']);
            $today = strtotime(date('Y-m-d'));

            if ($expireDate !== false && $expireDate < $today) {
                return 'expired';
            }
        }

        return 'active';
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
