#!/usr/bin/env python3
import requests
import sys
import json
from datetime import datetime, timedelta

class TimesheetAPITester:
    def __init__(self, base_url="https://shift-counter-9.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
        self.tests_run = 0
        self.tests_passed = 0
        self.admin_token = None
        self.employee_token = None
        self.pm_token = None

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        test_headers = self.session.headers.copy()
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"   Response: {response.json()}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_admin_login(self):
        """Test admin login with seeded credentials"""
        print("\n=== Testing Admin Authentication ===")
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "admin@timesheet.com", "password": "admin123"}
        )
        if success:
            self.admin_token = response.get('id')  # Store admin ID for later use
            print(f"Admin logged in successfully: {response.get('name')} ({response.get('role')})")
            return True
        return False

    def test_user_registration(self):
        """Test user registration flow"""
        print("\n=== Testing User Registration ===")
        
        # Register employee
        employee_data = {
            "email": f"employee_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "testpass123",
            "name": "Test Employee",
            "role": "employee"
        }
        success, response = self.run_test(
            "Employee Registration",
            "POST",
            "auth/register",
            200,
            data=employee_data
        )
        if success:
            self.employee_token = response.get('id')
            print(f"Employee registered: {response.get('name')} ({response.get('role')})")
        
        # Register PM
        pm_data = {
            "email": f"pm_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "testpass123",
            "name": "Test PM",
            "role": "project_manager"
        }
        success2, response2 = self.run_test(
            "PM Registration",
            "POST",
            "auth/register",
            200,
            data=pm_data
        )
        if success2:
            self.pm_token = response2.get('id')
            print(f"PM registered: {response2.get('name')} ({response2.get('role')})")
        
        return success and success2

    def test_task_codes(self):
        """Test task codes management"""
        print("\n=== Testing Task Codes ===")
        
        # Get task codes
        success, codes = self.run_test(
            "Get Task Codes",
            "GET",
            "task-codes",
            200
        )
        if success:
            print(f"Found {len(codes)} task codes")
            if len(codes) > 0:
                print(f"Sample codes: {[c['code'] for c in codes[:3]]}")
        
        # Add new task code
        new_code = {
            "code": f"TEST{datetime.now().strftime('%H%M')}",
            "description": "Test Code Description"
        }
        success2, response = self.run_test(
            "Create Task Code",
            "POST",
            "task-codes",
            200,
            data=new_code
        )
        if success2:
            print(f"Created task code: {response.get('code')}")
        
        return success and success2

    def test_project_managers(self):
        """Test project managers management"""
        print("\n=== Testing Project Managers ===")
        
        # Get PMs
        success, pms = self.run_test(
            "Get Project Managers",
            "GET",
            "project-managers",
            200
        )
        if success:
            print(f"Found {len(pms)} project managers")
        
        return success

    def test_timesheet_creation(self):
        """Test timesheet creation and management"""
        print("\n=== Testing Timesheet Operations ===")
        
        # Get user defaults first
        success, defaults = self.run_test(
            "Get User Defaults",
            "GET",
            "user-defaults",
            200
        )
        
        # Create a timesheet
        week_ending = (datetime.now() + timedelta(days=7)).isoformat()
        timesheet_data = {
            "employee_name": "Test Employee",
            "period_type": "weekly",
            "week_ending": week_ending,
            "days": [
                {
                    "day": "Monday",
                    "entries": [
                        {
                            "start_time": "08:00",
                            "lunch_duration": "30",
                            "finish_time": "17:00",
                            "total_hours": 8.5,
                            "job_number": "JOB001",
                            "task_code": "101",
                            "project_manager_id": None,
                            "other": "Test entry"
                        }
                    ]
                }
            ],
            "messages": "Test timesheet",
            "nights_away": 0,
            "total_hours": 8.5,
            "employee_signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        }
        
        success, response = self.run_test(
            "Create Timesheet",
            "POST",
            "timesheets",
            200,
            data=timesheet_data
        )
        
        timesheet_id = None
        if success:
            timesheet_id = response.get('id')
            print(f"Created timesheet: {timesheet_id}")
        
        # Get timesheets
        success2, timesheets = self.run_test(
            "Get Timesheets",
            "GET",
            "timesheets",
            200
        )
        if success2:
            print(f"Found {len(timesheets)} timesheets")
        
        # Get specific timesheet
        if timesheet_id:
            success3, timesheet = self.run_test(
                "Get Specific Timesheet",
                "GET",
                f"timesheets/{timesheet_id}",
                200
            )
            if success3:
                print(f"Retrieved timesheet: {timesheet.get('employee_name')} - {timesheet.get('status')}")
        
        return success and success2

    def test_dashboard_stats(self):
        """Test dashboard statistics"""
        print("\n=== Testing Dashboard Stats ===")
        
        success, stats = self.run_test(
            "Get Dashboard Stats",
            "GET",
            "dashboard/stats",
            200
        )
        if success:
            print(f"Dashboard stats: {stats}")
        
        return success

    def test_notification_settings(self):
        """Test notification settings"""
        print("\n=== Testing Notification Settings ===")
        
        # Get settings
        success, settings = self.run_test(
            "Get Notification Settings",
            "GET",
            "notification-settings",
            200
        )
        if success:
            print(f"Current settings: {settings}")
        
        # Update settings
        new_settings = {
            "reminder_time": "18:00",
            "reminder_day": "Thursday",
            "enabled": True
        }
        success2, response = self.run_test(
            "Update Notification Settings",
            "PUT",
            "notification-settings",
            200,
            data=new_settings
        )
        
        return success and success2

    def test_auth_endpoints(self):
        """Test authentication endpoints"""
        print("\n=== Testing Auth Endpoints ===")
        
        # Test /auth/me
        success, user = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        if success:
            print(f"Current user: {user.get('name')} ({user.get('role')})")
        
        # Test logout
        success2, response = self.run_test(
            "Logout",
            "POST",
            "auth/logout",
            200
        )
        
        return success and success2

def main():
    print("🚀 Starting Timesheet API Tests")
    print("=" * 50)
    
    tester = TimesheetAPITester()
    
    # Run all tests
    tests = [
        tester.test_admin_login,
        tester.test_user_registration,
        tester.test_task_codes,
        tester.test_project_managers,
        tester.test_timesheet_creation,
        tester.test_dashboard_stats,
        tester.test_notification_settings,
        tester.test_auth_endpoints
    ]
    
    for test in tests:
        try:
            test()
        except Exception as e:
            print(f"❌ Test failed with exception: {str(e)}")
    
    # Print summary
    print("\n" + "=" * 50)
    print(f"📊 Test Summary: {tester.tests_passed}/{tester.tests_run} tests passed")
    print(f"Success rate: {(tester.tests_passed/tester.tests_run)*100:.1f}%")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())