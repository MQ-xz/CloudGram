"""LoginScreen"""

from time import sleep
from functools import partial
from kivymd.uix.screen import MDScreen
from kivymd.uix.boxlayout import MDBoxLayout
from kivy.clock import Clock


class LoginScreen(MDScreen):
    """LoginScreen"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.phone_number = ""
        self.otp = None

    def otp_request(self, phone_number, *args):
        """send otp request to telegram"""
        print("hehe")
        sleep(2)
        print(self.phone_number, "otp_request")
        # add error
        phone_number.theme_text_color = "Error"
        phone_number.ids.send_otp_button.disabled = False
        phone_number.ids.send_otp_button.text = "Reending"
        # self.ids.login_screen_layout.remove_widget(phone_number)
        # self.ids.login_screen_layout.add_widget(EnterOTP())

    def send_otp(self, phone_number):
        """login"""
        print("Let's login : LoginScreen")

        self.phone_number = phone_number.ids.phone_number.text
        # set loading
        phone_number.ids.send_otp_button.disabled = True
        phone_number.ids.send_otp_button.text = "Sending"

        Clock.schedule_once(partial(self.otp_request, phone_number))

    def login(self, otp):
        """login"""
        print("Let's login : LoginScreen")
        self.otp = otp.ids.otp.text
        print(self.otp)
        self.manager.current = "home"


class EnterOTP(MDBoxLayout):
    """EnterOTP"""
